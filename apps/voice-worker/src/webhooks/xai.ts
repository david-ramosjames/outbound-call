import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  handleXaiWebhook,
  verifyXaiSignature,
  webhookSecretDiagnostics,
} from '../services/xai-webhook-handler.js';

export const xaiRouter: RouterType = Router();

xaiRouter.post(
  '/webhooks/xai/sip',
  (req: Request, res: Response): void => {
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
      headerValue(req, 'x-xai-signature') ??
      headerValue(req, 'x-webhook-signature');

    const signature = standardSignature ?? legacySignature;

    if (config.VOICE_MODE === 'live') {
      if (!signature) {
        logger.warn('xAI webhook missing signature headers', {
          headers: Object.keys(req.headers),
          ...webhookSecretDiagnostics(),
        });
        res.status(401).json({ error: 'Missing signature' });
        return;
      }

      const valid = verifyXaiSignature(
        rawBody,
        signature,
        standardId,
        standardTimestamp,
      );

      if (!valid) {
        logger.warn('xAI webhook signature verification failed', {
          hasStandardHeaders: Boolean(
            standardId && standardTimestamp && standardSignature,
          ),
          usedRawBuffer,
          bodyBytes: Buffer.byteLength(rawBody, 'utf8'),
          signaturePrefix: signature.slice(0, 6),
          ...webhookSecretDiagnostics(),
        });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    // Respond immediately
    res.status(200).json({ received: true });

    const payload =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    handleXaiWebhook(payload).catch((err) => {
      logger.error('xAI webhook processing error', {
        error: err,
        errorCategory: 'webhook_processing',
      });
    });
  }
);

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}
