import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import type { VoiceProvider } from '@outbound-call/shared';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  handleXaiWebhook,
  verifyXaiSignature,
  webhookSecretDiagnostics,
} from '../services/xai-webhook-handler.js';

export const xaiRouter: RouterType = Router();

/** Both providers send realtime.call.incoming as a Standard Webhooks request; only the secret differs. */
function sipWebhook(provider: VoiceProvider, secret: () => string) {
  return (req: Request, res: Response): void => {
    const rawBuf = (req as Request & { rawBody?: Buffer }).rawBody;
    const rawBody =
      rawBuf?.toString('utf8') ??
      (typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body ?? {}));

    const usedRawBuffer = Boolean(rawBuf);

    const standardId = headerValue(req, 'webhook-id');
    const standardTimestamp = headerValue(req, 'webhook-timestamp');
    const standardSignature = headerValue(req, 'webhook-signature');
    const legacySignature =
      provider === 'xai'
        ? headerValue(req, 'x-xai-signature') ?? headerValue(req, 'x-webhook-signature')
        : undefined;

    const signature = standardSignature ?? legacySignature;

    if (config.VOICE_MODE === 'live') {
      if (provider === 'openai' && !secret().trim()) {
        logger.warn('OpenAI webhook received but OPENAI_WEBHOOK_SECRET is not set');
        res.status(503).json({ error: 'OpenAI webhook not configured' });
        return;
      }

      if (!signature) {
        logger.warn(`${provider} webhook missing signature headers`, {
          headers: Object.keys(req.headers),
          ...webhookSecretDiagnostics(secret()),
        });
        res.status(401).json({ error: 'Missing signature' });
        return;
      }

      const valid = verifyXaiSignature(
        rawBody,
        signature,
        standardId,
        standardTimestamp,
        secret(),
      );

      if (!valid) {
        logger.warn(`${provider} webhook signature verification failed`, {
          hasStandardHeaders: Boolean(
            standardId && standardTimestamp && standardSignature,
          ),
          usedRawBuffer,
          bodyBytes: Buffer.byteLength(rawBody, 'utf8'),
          signaturePrefix: signature.slice(0, 6),
          ...webhookSecretDiagnostics(secret()),
        });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    // Respond immediately
    res.status(200).json({ received: true });

    const payload =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    handleXaiWebhook(payload, provider).catch((err) => {
      logger.error(`${provider} webhook processing error`, {
        error: err,
        errorCategory: 'webhook_processing',
      });
    });
  };
}

xaiRouter.post('/webhooks/xai/sip', sipWebhook('xai', () => config.XAI_SIP_WEBHOOK_SECRET));
xaiRouter.post('/webhooks/openai/sip', sipWebhook('openai', () => config.OPENAI_WEBHOOK_SECRET));

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}
