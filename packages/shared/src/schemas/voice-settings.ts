import { z } from 'zod';

/** Which realtime voice model runs the call. API keys live in the voice worker env. */
export const VOICE_PROVIDERS = ['xai', 'openai'] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];
export const VOICE_PROVIDER_LABELS: Record<VoiceProvider, string> = { xai: 'Grok (xAI)', openai: 'OpenAI' };

export const voiceSettingsSchema = z.object({
  id: z.string().uuid(),
  aiDisclosureText: z.string(),
  recordingDisclosureText: z.string(),
  recordingEnabled: z.boolean(),
  allowedCallStartTime: z.string(),
  allowedCallEndTime: z.string(),
  maximumCallDurationSeconds: z.number(),
  maximumHoldDurationSeconds: z.number(),
  defaultVoice: z.string(),
  voiceProvider: z.enum(VOICE_PROVIDERS),
  openaiVoice: z.string(),
  /** Outbound: connect calls through a Twilio conference so the AI can press keys in phone menus. */
  keypadEnabled: z.boolean(),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const DEFAULT_VOICE_SETTINGS = {
  aiDisclosureText: "Hello, this is an AI-assisted outbound calling agent with Ramos James Law. I'm calling you regarding a client insurance matter.",
  recordingDisclosureText: 'This call may be recorded for quality assurance purposes.',
  recordingEnabled: false,
  allowedCallStartTime: '09:00',
  allowedCallEndTime: '17:00',
  maximumCallDurationSeconds: 1800,
  maximumHoldDurationSeconds: 600,
  defaultVoice: 'eve',
  voiceProvider: 'xai' as VoiceProvider,
  openaiVoice: 'marin',
  keypadEnabled: false,
  isEnabled: true,
};
