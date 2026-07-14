import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  XAI_API_KEY: z.string().min(1),
  XAI_SIP_PHONE_NUMBER_ID: z.string().min(1),
  XAI_SIP_WEBHOOK_SECRET: z.string().min(1),
  XAI_REALTIME_URL: z.string().url().default('wss://api.x.ai/v1/realtime'),

  TELNYX_API_KEY: z.string().min(1),
  TELNYX_PUBLIC_KEY: z.string().min(1),
  TELNYX_CONNECTION_ID: z.string().min(1),
  TELNYX_OUTBOUND_VOICE_PROFILE_ID: z.string().min(1),
  TELNYX_CALLER_ID_NUMBER: z.string().min(1),
  TELNYX_SIP_CONNECTION_ID: z.string().min(1),

  VOICE_MODE: z.enum(['mock', 'live']).default('mock'),
  VOICE_WORKER_INTERNAL_SECRET: z.string().min(1),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  VOICE_WORKER_BASE_URL: z.string().url().default('http://localhost:3001'),

  PORT: z.coerce.number().default(3001),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues.map(
      (i) => `  ${i.path.join('.')}: ${i.message}`
    );
    console.error(
      `❌ Invalid environment configuration:\n${missing.join('\n')}`
    );
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
export type Config = z.infer<typeof envSchema>;
