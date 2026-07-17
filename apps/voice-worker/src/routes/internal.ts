import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { launchCall } from '../services/call-launcher.js';

export const internalRouter: RouterType = Router();

const launchCallBodySchema = z.object({
  missionId: z.string().uuid('missionId must be a valid UUID'),
});

internalRouter.post(
  '/internal/launch-call',
  async (req: Request, res: Response): Promise<void> => {
    // Authenticate with internal secret (accept either header name)
    const authHeader =
      (req.headers['x-internal-secret'] as string | undefined) ??
      (req.headers['x-voice-worker-secret'] as string | undefined);

    if (!authHeader || authHeader !== config.VOICE_WORKER_INTERNAL_SECRET) {
      logger.warn('Unauthorized internal request');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Validate body
    const parsed = launchCallBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
      return;
    }

    const { missionId } = parsed.data;

    logger.info('Launch call requested', { missionId });

    try {
      const result = await launchCall(missionId);

      if (result.success) {
        res.status(200).json({
          status: 'launched',
          callSessionId: result.callSessionId,
        });
      } else {
        res.status(422).json({
          status: 'failed',
          error: result.error,
        });
      }
    } catch (err) {
      logger.error('Launch call error', {
        missionId,
        error: err,
        errorCategory: 'launch_call',
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);
