import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = {
  XAI_API_KEY: 'xai-key',
  XAI_SIP_URI: 'sip:agent@sip.x.ai',
  XAI_REALTIME_URL: 'wss://api.x.ai/v1/realtime',
  OPENAI_API_KEY: '',
  OPENAI_PROJECT_ID: '',
  OPENAI_WEBHOOK_SECRET: '',
  OPENAI_REALTIME_MODEL: 'gpt-realtime-2.1',
  OPENAI_TRANSCRIBE_MODEL: 'gpt-4o-transcribe',
};

vi.mock('../config.js', () => ({ config: env }));
vi.mock('../lib/supabase.js', () => ({ supabase: {} }));

const { buildRealtimeSession, resolveProvider, sipUriFor, voiceFor } = await import('../services/realtime-provider.js');

describe('realtime provider', () => {
  beforeEach(() => {
    env.OPENAI_API_KEY = '';
    env.OPENAI_PROJECT_ID = '';
    env.OPENAI_WEBHOOK_SECRET = '';
  });

  it('falls back to Grok when OpenAI is selected but not configured', () => {
    expect(resolveProvider('openai')).toBe('xai');
    expect(resolveProvider(undefined)).toBe('xai');
  });

  it('uses OpenAI once its key, project and webhook secret are set', () => {
    env.OPENAI_API_KEY = 'sk-test';
    env.OPENAI_PROJECT_ID = 'proj_123';
    env.OPENAI_WEBHOOK_SECRET = 'whsec_abc';
    expect(resolveProvider('openai')).toBe('openai');
    expect(sipUriFor('openai')).toBe('sip:proj_123@sip.api.openai.com;transport=tls');
    expect(sipUriFor('xai')).toBe('sip:agent@sip.x.ai');
  });

  it('keeps each provider to its own voices', () => {
    expect(voiceFor('openai', 'ara')).toBe('marin');
    expect(voiceFor('openai', 'cedar')).toBe('cedar');
    expect(voiceFor('xai', 'celeste')).toBe('celeste');
  });

  it('builds the session in each provider schema', () => {
    const input = { instructions: 'Be nice', tools: [{ type: 'function', name: 'x' }], voice: 'cedar' };
    const openai = buildRealtimeSession('openai', input);
    expect(openai).toMatchObject({
      type: 'realtime',
      instructions: 'Be nice',
      audio: { output: { voice: 'cedar' }, input: { turn_detection: { type: 'server_vad' } } },
    });
    expect(openai).not.toHaveProperty('voice');

    const xai = buildRealtimeSession('xai', { ...input, voice: 'eve' });
    expect(xai).toMatchObject({ voice: 'eve', turn_detection: { type: 'server_vad' } });
    expect(xai).not.toHaveProperty('type');
  });
});
