import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../lib/supabase.js';
import { handleTwilioWebhook } from '../services/twilio-webhook-handler.js';
import { resolveProvider, sipUriFor } from '../services/realtime-provider.js';
import {
  carrierConferenceTwiml,
  clearKeypadMetadata,
  conferenceName,
  endKeypadConference,
  redirectCall,
  saveKeypadMetadata,
  startAiLeg,
} from '../services/keypad.js';

export const twilioRouter: RouterType = Router();

// TwiML endpoint: instructs Twilio to bridge the answered call to xAI's SIP endpoint
twilioRouter.post(
  '/webhooks/twilio/twiml',
  async (req: Request, res: Response): Promise<void> => {
    const missionId = (req.query.missionId as string) || '';

    logger.info('TwiML requested for SIP bridge', { missionId });

    let correlationToken = missionId;
    if (missionId) {
      const { data: mission } = await supabase
        .from('call_missions')
        .select('correlation_token, id')
        .eq('id', missionId)
        .maybeSingle();

      correlationToken = mission?.correlation_token || missionId;
    }

    const { data: vsRow } = await supabase.from('voice_settings').select('*').limit(1).maybeSingle();
    const provider = resolveProvider((vsRow as { voice_provider?: string } | null)?.voice_provider);

    // Twilio forwards custom X-headers most reliably as SIP URI query params.
    // Nested <Header> is also included as a backup.
    const sipUri = appendSipParams(sipUriFor(provider), {
      'X-Correlation-Token': correlationToken,
      'X-Mission-Id': missionId,
    });

    logger.info('TwiML SIP bridge URI prepared', {
      missionId,
      correlationToken,
      provider,
      sipUriPreview: sipUri.slice(0, 160),
    });

    const directTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true" timeout="60">
    <Sip>${escapeXml(sipUri)}</Sip>
  </Dial>
</Response>`;

    const vs = vsRow as { keypad_enabled?: boolean; maximum_call_duration_seconds?: number } | null;
    const carrierSid = typeof req.body?.CallSid === 'string' ? req.body.CallSid : '';
    if (vs?.keypad_enabled === true && missionId && carrierSid && config.VOICE_MODE === 'live') {
      const room = conferenceName(missionId);
      const timeLimitSeconds = Math.min(Math.max((vs.maximum_call_duration_seconds ?? 1800) + 120, 300), 14400);
      // Answer Twilio right away; the AI leg is dialed in parallel so the carrier isn't left waiting on our API calls.
      res.status(200).set('Content-Type', 'text/xml').send(carrierConferenceTwiml(room, timeLimitSeconds));
      void startKeypadAiLeg({ missionId, carrierSid, sipUri, room, timeLimitSeconds, directTwiml });
      return;
    }

    res.status(200).set('Content-Type', 'text/xml').send(directTwiml);
  }
);

/** Keypad mode: dial the AI into the conference. If that fails, move the carrier back to the direct SIP bridge. */
async function startKeypadAiLeg(input: {
  missionId: string;
  carrierSid: string;
  sipUri: string;
  room: string;
  timeLimitSeconds: number;
  directTwiml: string;
}): Promise<void> {
  const { missionId, carrierSid, sipUri, room, timeLimitSeconds, directTwiml } = input;
  const { data: session } = await supabase
    .from('call_sessions')
    .select('id')
    .eq('call_mission_id', missionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  try {
    if (session?.id) await saveKeypadMetadata(session.id, { keypad_conference: room, time_limit_seconds: timeLimitSeconds });
    const aiCallSid = await startAiLeg({ sipUri, room, missionId, timeLimitSeconds });
    if (session?.id) await saveKeypadMetadata(session.id, { keypad_conference: room, ai_call_sid: aiCallSid, time_limit_seconds: timeLimitSeconds });
    logger.info('Keypad mode: carrier and AI joined via conference', { missionId, twilioCallSid: carrierSid, aiCallSid });
  } catch (err) {
    logger.error('Keypad mode: could not start AI leg; switching to direct bridge', { missionId, error: err, errorCategory: 'twilio_api' });
    if (session?.id) await clearKeypadMetadata(session.id);
    await redirectCall(carrierSid, directTwiml).catch((e) =>
      logger.error('Keypad mode: fallback redirect failed', { missionId, error: e, errorCategory: 'twilio_api' }),
    );
  }
}

function appendSipParams(
  sipUri: string,
  params: Record<string, string>,
): string {
  const qs = Object.entries(params)
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  if (!qs) return sipUri;
  const joiner = sipUri.includes('?') ? '&' : '?';
  return `${sipUri}${joiner}${qs}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function validateTwilioSignature(req: Request): boolean {
  const signature = req.headers['x-twilio-signature'] as string;
  if (!signature) return false;

  const authToken = config.TWILIO_AUTH_TOKEN;
  const url = `${config.VOICE_WORKER_BASE_URL}${req.originalUrl}`;

  // Build the data string: URL + sorted POST params
  const params = req.body as Record<string, string>;
  const sortedKeys = Object.keys(params).sort();
  const dataString = sortedKeys.reduce((acc, key) => acc + key + params[key], url);

  const computed = crypto
    .createHmac('sha1', authToken)
    .update(dataString)
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computed)
  );
}

/** Keypad mode: the AI's SIP leg ended (or never connected), so close the conference and hang up the carrier. */
twilioRouter.post('/webhooks/twilio/keypad-ai-leg', (req: Request, res: Response): void => {
  if (config.VOICE_MODE === 'live' && !validateTwilioSignature(req)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }
  res.status(200).set('Content-Type', 'text/xml').send('<Response/>');
  const missionId = String(req.query.missionId ?? '');
  const body = req.body as Record<string, string>;
  logger.info('Keypad AI leg ended', { missionId, twilioCallSid: body.CallSid, status: body.CallStatus, sipResponseCode: body.SipResponseCode });
  if (missionId) void endKeypadConference(conferenceName(missionId));
});

twilioRouter.post(
  '/webhooks/twilio/calls',
  (req: Request, res: Response): void => {
    if (config.VOICE_MODE === 'live') {
      const valid = validateTwilioSignature(req);
      if (!valid) {
        logger.warn('Twilio webhook signature verification failed');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    // Respond immediately — processing is async
    res.status(200).set('Content-Type', 'text/xml').send('<Response/>');

    handleTwilioWebhook(req.body).catch((err) => {
      logger.error('Twilio webhook processing error', {
        error: err,
        errorCategory: 'webhook_processing',
      });
    });
  }
);
