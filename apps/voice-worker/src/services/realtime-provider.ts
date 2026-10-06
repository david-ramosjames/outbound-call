import WebSocket from 'ws';
import type { VoiceProvider } from '@outbound-call/shared';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { normalizeOpenaiVoice, normalizeXaiVoice } from './map-mission.js';

const OPENAI_API = 'https://api.openai.com/v1';
const OPENAI_REALTIME_WS = 'wss://api.openai.com/v1/realtime';

export function openaiConfigured(): boolean {
  return Boolean(config.OPENAI_API_KEY.trim() && config.OPENAI_PROJECT_ID.trim() && config.OPENAI_WEBHOOK_SECRET.trim());
}

/** The provider a call will actually use: OpenAI only when it is fully configured, otherwise Grok. */
export function resolveProvider(requested: string | null | undefined): VoiceProvider {
  if (requested !== 'openai') return 'xai';
  if (openaiConfigured()) return 'openai';
  logger.warn('OpenAI selected in settings but OPENAI_API_KEY / OPENAI_PROJECT_ID / OPENAI_WEBHOOK_SECRET are not all set; using Grok');
  return 'xai';
}

/** SIP address Twilio dials to reach the provider. */
export function sipUriFor(provider: VoiceProvider): string {
  if (provider === 'openai') return `sip:${config.OPENAI_PROJECT_ID.trim()}@sip.api.openai.com;transport=tls`;
  return config.XAI_SIP_URI;
}

export function voiceFor(provider: VoiceProvider, voice: string): string {
  return provider === 'openai' ? normalizeOpenaiVoice(voice) : normalizeXaiVoice(voice);
}

export function openRealtimeSocket(provider: VoiceProvider, callId: string): WebSocket {
  const url = provider === 'openai' ? OPENAI_REALTIME_WS : config.XAI_REALTIME_URL;
  const key = provider === 'openai' ? config.OPENAI_API_KEY : config.XAI_API_KEY;
  return new WebSocket(`${url}?call_id=${encodeURIComponent(callId)}`, { headers: { Authorization: `Bearer ${key}` } });
}

interface SessionInput {
  instructions: string;
  tools: unknown[];
  voice: string;
}

/** The `session` object for session.update, in each provider's schema. */
export function buildRealtimeSession(provider: VoiceProvider, input: SessionInput): Record<string, unknown> {
  const voice = voiceFor(provider, input.voice);
  if (provider === 'openai') {
    return {
      type: 'realtime',
      instructions: input.instructions,
      tools: input.tools,
      tool_choice: 'auto',
      audio: {
        input: {
          transcription: { model: config.OPENAI_TRANSCRIBE_MODEL },
          turn_detection: { type: 'server_vad' },
        },
        output: { voice },
      },
    };
  }
  return {
    instructions: input.instructions,
    tools: input.tools,
    voice,
    turn_detection: { type: 'server_vad' },
    audio: { input: { transcription: { model: 'grok-transcribe' } } },
  };
}

/**
 * OpenAI SIP calls ring until the backend accepts them with a session config. Grok calls need no accept step.
 * Returns false if OpenAI refused (the Twilio leg then fails over to the fallback routing).
 */
export async function acceptCall(provider: VoiceProvider, callId: string, session: Record<string, unknown>): Promise<boolean> {
  if (provider !== 'openai') return true;
  try {
    const res = await fetch(`${OPENAI_API}/realtime/calls/${encodeURIComponent(callId)}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...session, model: config.OPENAI_REALTIME_MODEL }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.error('OpenAI refused to accept the call', {
        openaiCallId: callId,
        status: `${res.status}`,
        errorMessage: (await res.text()).slice(0, 500),
        errorCategory: 'openai_session',
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('OpenAI accept request failed', { openaiCallId: callId, error: err, errorCategory: 'openai_session' });
    return false;
  }
}
