export const SPEAKERS = [
  'ai_agent',
  'insurance_representative',
  'automated_phone_system',
  'unknown',
] as const;

export type Speaker = (typeof SPEAKERS)[number];
