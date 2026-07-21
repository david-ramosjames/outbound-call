import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../lib/supabase.js';
import { handleTwilioWebhook } from '../services/twilio-webhook-handler.js';

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

    // Custom SIP headers + URI query params let the xAI realtime.call.incoming
    // webhook correlate back to this mission (Twilio forwards both forms).
    const sipUri = appendSipParams(config.XAI_SIP_URI, {
      'X-Correlation-Token': correlationToken,
      'X-Mission-Id': missionId,
    });

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true">
    <Sip>
      ${escapeXml(sipUri)}
      <Header name="X-Correlation-Token" value="${escapeXml(correlationToken)}" />
      <Header name="X-Mission-Id" value="${escapeXml(missionId)}" />
    </Sip>
  </Dial>
</Response>`;

    res.status(200).set('Content-Type', 'text/xml').send(twiml);
  }
);

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
