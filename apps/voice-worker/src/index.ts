console.log('[voice-worker] Starting...');

import express, { type Request, type Response, type NextFunction, type Express } from 'express';

let config: { PORT: number; VOICE_MODE: string };
try {
  const configModule = await import('./config.js');
  config = configModule.config;
  console.log('[voice-worker] Config loaded successfully');
} catch (err) {
  console.error('[voice-worker] FATAL: Config failed to load:', err);
  process.exit(1);
}

let logger: { info: (msg: string, ctx?: Record<string, unknown>) => void; error: (msg: string, ctx?: Record<string, unknown>) => void };
try {
  const loggerModule = await import('./utils/logger.js');
  logger = loggerModule.logger;
} catch (err) {
  console.error('[voice-worker] Logger import failed:', err);
  logger = { info: console.log, error: console.error };
}

const app: Express = express();

// Parse URL-encoded bodies (Twilio sends form-encoded webhooks)
app.use(express.urlencoded({ extended: false }));

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

// Routes (lazy import to avoid crash if sub-dependencies fail)
try {
  const { twilioRouter } = await import('./webhooks/twilio.js');
  const { xaiRouter } = await import('./webhooks/xai.js');
  const { internalRouter } = await import('./routes/internal.js');

  app.use(twilioRouter);
  app.use(xaiRouter);
  app.use(internalRouter);
  console.log('[voice-worker] Routes registered');
} catch (err) {
  console.error('[voice-worker] Failed to load routes:', err);
}

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
app.listen(port, '0.0.0.0', () => {
  const modeLabel =
    config.VOICE_MODE === 'mock'
      ? '🔶 MOCK MODE — no real calls will be placed'
      : '🟢 LIVE MODE — real calls enabled';

  logger.info(`Voice worker started on port ${port}`, {
    status: config.VOICE_MODE,
  });
  console.log(`\n  voice-worker listening on http://0.0.0.0:${port}`);
  console.log(`  ${modeLabel}\n`);

  if (config.VOICE_MODE === 'live') {
    import('./services/xai-webhook-handler.js')
      .then(({ webhookSecretDiagnostics }) => {
        console.log(
          '  xAI webhook secret:',
          JSON.stringify(webhookSecretDiagnostics()),
        );
      })
      .catch((err) => {
        console.warn('  Could not diagnose webhook secret:', err);
      });
  }
});

export default app;
