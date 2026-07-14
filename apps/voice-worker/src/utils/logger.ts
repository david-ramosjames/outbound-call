export interface LogContext {
  missionId?: string;
  callSessionId?: string;
  telnyxCallSessionId?: string;
  xaiCallId?: string;
  eventType?: string;
  status?: string;
  duration?: number;
  errorCategory?: string;
  [key: string]: unknown;
}

const REDACTED_KEYS = new Set([
  'apiKey',
  'api_key',
  'authorization',
  'Authorization',
  'secret',
  'password',
  'token',
  'SUPABASE_SERVICE_ROLE_KEY',
  'XAI_API_KEY',
  'TELNYX_API_KEY',
  'VOICE_WORKER_INTERNAL_SECRET',
]);

function sanitize(ctx: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (REDACTED_KEYS.has(key)) {
      clean[key] = '[REDACTED]';
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function formatLog(
  level: string,
  message: string,
  ctx?: LogContext
): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (ctx) {
    Object.assign(entry, sanitize(ctx));
  }

  return JSON.stringify(entry);
}

export const logger = {
  info(message: string, ctx?: LogContext): void {
    console.log(formatLog('INFO', message, ctx));
  },

  warn(message: string, ctx?: LogContext): void {
    console.warn(formatLog('WARN', message, ctx));
  },

  error(message: string, ctx?: LogContext & { error?: unknown }): void {
    const logCtx = { ...ctx };
    if (ctx?.error instanceof Error) {
      logCtx.errorMessage = ctx.error.message;
      logCtx.errorStack = ctx.error.stack;
      delete logCtx.error;
    }
    console.error(formatLog('ERROR', message, logCtx));
  },

  debug(message: string, ctx?: LogContext): void {
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(formatLog('DEBUG', message, ctx));
    }
  },

  mock(message: string, ctx?: LogContext): void {
    console.log(
      formatLog('MOCK', `🔶 [MOCK MODE] ${message}`, ctx)
    );
  },
};
