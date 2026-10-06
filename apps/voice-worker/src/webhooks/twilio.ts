import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../lib/supabase.js';
import { handleTwilioWebhook } from '../services/twilio-webhook-handler.js';
import { resolveProvider, sipUriFor } from '../services/realtime-provider.js';
import { carrierConferenceTwiml, conferenceName, endKeypadConference, saveKeypadMetadata, startAiLeg } from '../services/keypad.js';

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

    const vs = vsRow as { keypad_enabled?: boolean; maximum_call_duration_seconds?: number } | null;
    if (vs?.keypad_enabled === true && missionId && config.VOICE_MODE === 'live') {
      const keypadTwiml = await startKeypadBridge(req, missionId, sipUri, vs.maximum_call_duration_seconds);
      if (keypadTwiml) {
        res.status(200).set('Content-Type', 'text/xml').send(keypadTwiml);
        return;
      }
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true" timeout="60">
    <Sip>${escapeXml(sipUri)}</Sip>
  </Dial>
</Response>`;

    res.status(200).set('Content-Type', 'text/xml').send(twiml);
  }
);

/**
 * Keypad mode: dial the AI into a conference and return TwiML that puts the carrier in the same room.
 * Returns null (caller falls back to the direct SIP bridge) if anything fails.
 */
async function startKeypadBridge(
  req: Request,
  missionId: string,
  sipUri: string,
  maxCallSeconds: number | undefined,
): Promise<string | null> {
  const carrierSid = typeof req.body?.CallSid === 'string' ? req.body.CallSid : '';
  const { data: session } = await supabase
    .from('call_sessions')
    .select('id')
    .eq('call_mission_id', missionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session?.id) {
    logger.warn('Keypad mode: no call session for mission; using direct bridge', { missionId });
    return null;
  }
  const room = conferenceName(missionId);
  const timeLimitSeconds = Math.min(Math.max((maxCallSeconds ?? 1800) + 120, 300), 14400);
  try {
    const aiCallSid = await startAiLeg({ sipUri, room, missionId, timeLimitSeconds });
    await saveKeypadMetadata(session.id, { keypad_conference: room, ai_call_sid: aiCallSid, time_limit_seconds: timeLimitSeconds });
    logger.info('Keypad mode: carrier and AI joined via conference', { missionId, twilioCallSid: carrierSid, aiCallSid });
    return carrierConferenceTwiml(room, timeLimitSeconds);
  } catch (err) {
    logger.error('Keypad mode: could not start AI leg; using direct bridge', { missionId, error: err, errorCategory: 'twilio_api' });
    return null;
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
