import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import { logger } from '../utils/logger.js';
import {
  handleTelnyxWebhook,
  verifyTelnyxSignature,
} from '../services/telnyx-webhook-handler.js';

export const telnyxRouter: RouterType = Router();

telnyxRouter.post(
  '/webhooks/telnyx/calls',
  (req: Request, res: Response): void => {
    const signature = req.headers['telnyx-signature-ed25519'] as string;
    const timestamp = req.headers['telnyx-timestamp'] as string;
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

    if (rawBody && signature && timestamp) {
      const valid = verifyTelnyxSignature(rawBody, signature, timestamp);
      if (!valid) {
        logger.warn('Telnyx webhook signature verification failed');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    // Respond immediately — webhook processing is async
    res.status(200).json({ received: true });

    handleTelnyxWebhook(req.body).catch((err) => {
      logger.error('Telnyx webhook processing error', {
        error: err,
        errorCategory: 'webhook_processing',
      });
    });
  }
);
