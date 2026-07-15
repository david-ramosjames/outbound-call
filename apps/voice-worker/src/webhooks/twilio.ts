import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { handleTwilioWebhook } from '../services/twilio-webhook-handler.js';

export const twilioRouter: RouterType = Router();

// TwiML endpoint: instructs Twilio to bridge the call to xAI's SIP endpoint
twilioRouter.post(
  '/webhooks/twilio/twiml',
  (req: Request, res: Response): void => {
    const missionId = req.query.missionId as string;

    logger.info('TwiML requested for SIP bridge', { missionId });

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>${config.XAI_SIP_URI}</Sip>
  </Dial>
</Response>`;

    res.status(200).set('Content-Type', 'text/xml').send(twiml);
  }
);

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
