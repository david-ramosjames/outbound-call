import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import { logger } from '../utils/logger.js';
import {
  handleXaiWebhook,
  verifyXaiSignature,
} from '../services/xai-webhook-handler.js';

export const xaiRouter: RouterType = Router();

xaiRouter.post(
  '/webhooks/xai/sip',
  (req: Request, res: Response): void => {
    const signature = req.headers['x-xai-signature'] as string | undefined;

    if (signature) {
      const rawBody = JSON.stringify(req.body);
      const valid = verifyXaiSignature(rawBody, signature);
      if (!valid) {
        logger.warn('xAI webhook signature verification failed');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    // Respond immediately
    res.status(200).json({ received: true });

    handleXaiWebhook(req.body).catch((err) => {
      logger.error('xAI webhook processing error', {
        error: err,
        errorCategory: 'webhook_processing',
      });
    });
  }
);
