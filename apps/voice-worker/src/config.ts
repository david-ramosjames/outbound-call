import { z } from 'zod';
import 'dotenv/config';

const isMock = process.env.VOICE_MODE !== 'live';

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  XAI_API_KEY: isMock ? z.string().default('mock-xai-key') : z.string().min(1),
  XAI_AGENT_ID: isMock ? z.string().default('mock-agent-id') : z.string().min(1),
  XAI_SIP_URI: isMock ? z.string().default('sip:mock@localhost') : z.string().min(1),
  XAI_SIP_WEBHOOK_SECRET: isMock ? z.string().default('mock-webhook-secret') : z.string().min(1),
  XAI_REALTIME_URL: z.string().url().default('wss://api.x.ai/v1/realtime'),

  TWILIO_ACCOUNT_SID: isMock ? z.string().default('mock-twilio-sid') : z.string().min(1),
  TWILIO_AUTH_TOKEN: isMock ? z.string().default('mock-twilio-token') : z.string().min(1),
  TWILIO_PHONE_NUMBER: isMock ? z.string().default('+10000000000') : z.string().min(1),

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
