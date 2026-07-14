import { z } from 'zod';

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
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const DEFAULT_VOICE_SETTINGS = {
  aiDisclosureText: "Hello, I'm an AI-assisted calling agent contacting you on behalf of Ramos James Law regarding a client insurance matter.",
  recordingDisclosureText: 'This call may be recorded for quality assurance purposes.',
  recordingEnabled: false,
  allowedCallStartTime: '09:00',
  allowedCallEndTime: '17:00',
  maximumCallDurationSeconds: 1800,
  maximumHoldDurationSeconds: 600,
  defaultVoice: 'alloy',
  isEnabled: true,
};
