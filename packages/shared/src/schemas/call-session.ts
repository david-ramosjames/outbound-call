import { z } from 'zod';

export const callSessionSchema = z.object({
  id: z.string().uuid(),
  callMissionId: z.string().uuid(),
  provider: z.enum(['telnyx', 'xai', 'mock']),
  telnyxCallControlId: z.string().nullable(),
  telnyxCallSessionId: z.string().nullable(),
  telnyxCallLegId: z.string().nullable(),
  xaiCallId: z.string().nullable(),
  xaiConnectionStatus: z.enum(['pending', 'connecting', 'connected', 'disconnected', 'error']).nullable(),
  sipStatus: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  disconnectReason: z.string().nullable(),
  providerMetadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CallSession = z.infer<typeof callSessionSchema>;
