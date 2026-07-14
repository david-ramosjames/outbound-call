import { z } from 'zod';

export const EVENT_SOURCES = ['telnyx', 'xai', 'system', 'mock'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const CALL_EVENT_TYPES = [
  'mission_authorized',
  'telnyx_call_requested',
  'telnyx_call_initiated',
  'dialing',
  'ringing',
  'answered',
  'xai_sip_call_received',
  'xai_websocket_connected',
  'agent_session_configured',
  'ai_speech_started',
  'ai_speech_ended',
  'representative_speech_started',
  'representative_speech_ended',
  'dtmf_sent',
  'tool_call_requested',
  'tool_result_returned',
  'call_on_hold',
  'call_resumed',
  'transcript_segment',
  'call_completed',
  'call_failed',
  'websocket_disconnected',
  'structured_extraction_completed',
  'human_review_completed',
  'proposed_update_applied',
] as const;

export type CallEventType = (typeof CALL_EVENT_TYPES)[number];

export const callEventSchema = z.object({
  id: z.string().uuid(),
  callMissionId: z.string().uuid(),
  callSessionId: z.string().uuid().nullable(),
  source: z.enum(EVENT_SOURCES),
  externalEventId: z.string().nullable(),
  eventType: z.enum(CALL_EVENT_TYPES),
  providerStatus: z.string().nullable(),
  sequenceNumber: z.number(),
  eventPayload: z.record(z.unknown()).nullable(),
  occurredAt: z.string(),
  processedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type CallEvent = z.infer<typeof callEventSchema>;
