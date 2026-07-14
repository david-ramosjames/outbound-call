import express, { type Request, type Response, type NextFunction, type Express } from 'express';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { twilioRouter } from './webhooks/twilio.js';
import { xaiRouter } from './webhooks/xai.js';
import { internalRouter } from './routes/internal.js';

const app: Express = express();

// Capture raw body for webhook signature verification, then parse JSON
app.use(
  express.json({
    verify: (req: Request, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`, {
    eventType: 'http_request',
  });
  next();
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'voice-worker',
    voiceMode: config.VOICE_MODE,
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use(twilioRouter);
app.use(xaiRouter);
app.use(internalRouter);

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', {
    error: err,
    errorCategory: 'unhandled',
  });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const port = config.PORT;
app.listen(port, () => {
  const modeLabel =
    config.VOICE_MODE === 'mock'
      ? '🔶 MOCK MODE — no real calls will be placed'
      : '🟢 LIVE MODE — real calls enabled';

  logger.info(`Voice worker started on port ${port}`, {
    status: config.VOICE_MODE,
  });
  console.log(`\n  voice-worker listening on http://localhost:${port}`);
  console.log(`  ${modeLabel}\n`);
});

export default app;
