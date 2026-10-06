import { describe, it, expect, vi } from 'vitest';

const sessionRow: { current: Record<string, unknown> | null } = { current: null };

vi.mock('../config.js', () => ({
  config: { VOICE_MODE: 'mock', TWILIO_ACCOUNT_SID: 'AC_test', TWILIO_AUTH_TOKEN: 'x', VOICE_WORKER_BASE_URL: 'https://w.test' },
}));
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: sessionRow.current }) }) }),
    }),
  },
}));

const { carrierConferenceTwiml, conferenceName, KEYPAD_DIGITS, pressKeys } = await import('../services/keypad.js');
const { getToolDefinitions } = await import('../services/grok-tools.js');

describe('keypad mode', () => {
  it('carrier TwiML keeps the conference open on exit and plays digits before rejoining', () => {
    const room = conferenceName('abc');
    const plain = carrierConferenceTwiml(room, 1920);
    expect(plain).toContain('endConferenceOnExit="false"');
    expect(plain).toContain('timeLimit="1920"');
    expect(plain).toContain('>mission-abc</Conference>');
    expect(plain).not.toContain('<Play');

    const withDigits = carrierConferenceTwiml(room, 1920, '4');
    expect(withDigits.indexOf('<Play digits="4"/>')).toBeLessThan(withDigits.indexOf('<Dial'));
  });

  it('accepts only keypad characters', () => {
    expect(KEYPAD_DIGITS.test('4')).toBe(true);
    expect(KEYPAD_DIGITS.test('12w34#')).toBe(true);
    expect(KEYPAD_DIGITS.test('four')).toBe(false);
    expect(KEYPAD_DIGITS.test('')).toBe(false);
    expect(KEYPAD_DIGITS.test('1"/><Hangup/>')).toBe(false);
  });

  it('refuses to press keys when the call was not connected in keypad mode', async () => {
    sessionRow.current = { telnyx_call_control_id: 'CA1', provider_metadata: null };
    expect(await pressKeys('s1', '4')).toEqual({ ok: false, reason: 'not_available' });
    sessionRow.current = { telnyx_call_control_id: 'CA1', provider_metadata: { keypad_conference: 'mission-abc' } };
    expect(await pressKeys('s1', '4')).toEqual({ ok: true });
    expect(await pressKeys('s1', 'x')).toEqual({ ok: false, reason: 'invalid_digits' });
  });

  it('only offers press_keys when keypad is enabled', () => {
    expect(getToolDefinitions().some((t) => t.name === 'press_keys')).toBe(false);
    expect(getToolDefinitions({ keypad: true }).some((t) => t.name === 'press_keys')).toBe(true);
  });
});
