import Twilio from 'twilio';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';

/**
 * Keypad mode: the carrier call and the AI's SIP leg meet in a Twilio conference instead of a direct <Dial><Sip>.
 * Neither Grok nor OpenAI Realtime can send DTMF, so to press keys the carrier leg is redirected out of the
 * conference, Twilio plays the tones to the carrier, and the leg rejoins. The AI leg stays connected throughout.
 */

export const KEYPAD_DIGITS = /^[0-9*#wW]{1,32}$/;

let client: ReturnType<typeof Twilio> | null = null;
function twilio() {
  if (!client) client = Twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  return client;
}

export interface KeypadMetadata {
  keypad_conference: string;
  ai_call_sid?: string;
  time_limit_seconds?: number;
}

export function conferenceName(missionId: string): string {
  return `mission-${missionId}`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Carrier leg: must not end the conference on exit, because it leaves briefly for every key press.
 * timeLimit stops it from sitting in an empty room if the AI side is already gone when it rejoins.
 */
export function carrierConferenceTwiml(room: string, timeLimitSeconds: number, digits?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>${digits ? `\n  <Play digits="${escapeXml(digits)}"/>` : ''}
  <Dial timeLimit="${timeLimitSeconds}">
    <Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false" waitUrl="">${escapeXml(room)}</Conference>
  </Dial>
</Response>`;
}

function aiConferenceTwiml(room: string): string {
  return `<Response><Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="true" waitUrl="">${escapeXml(room)}</Conference></Dial></Response>`;
}

/** Dial the AI over SIP and drop it into the conference. Returns the AI leg's call SID. */
export async function startAiLeg(input: { sipUri: string; room: string; missionId: string; timeLimitSeconds: number }): Promise<string> {
  const statusCallback = `${config.VOICE_WORKER_BASE_URL.replace(/\/$/, '')}/webhooks/twilio/keypad-ai-leg?missionId=${encodeURIComponent(input.missionId)}`;
  const call = await twilio().calls.create({
    to: input.sipUri,
    from: config.TWILIO_PHONE_NUMBER,
    twiml: aiConferenceTwiml(input.room),
    timeLimit: input.timeLimitSeconds,
    statusCallback,
    statusCallbackEvent: ['completed'],
    statusCallbackMethod: 'POST',
  });
  return call.sid;
}

async function loadSession(callSessionId: string): Promise<{ carrierSid: string | null; meta: Partial<KeypadMetadata> }> {
  const { data } = await supabase
    .from('call_sessions')
    .select('telnyx_call_control_id, provider_metadata')
    .eq('id', callSessionId)
    .maybeSingle();
  const row = data as { telnyx_call_control_id?: string | null; provider_metadata?: Record<string, unknown> | null } | null;
  return { carrierSid: row?.telnyx_call_control_id ?? null, meta: (row?.provider_metadata ?? {}) as Partial<KeypadMetadata> };
}

export async function saveKeypadMetadata(callSessionId: string, meta: KeypadMetadata): Promise<void> {
  const { data } = await supabase.from('call_sessions').select('provider_metadata').eq('id', callSessionId).maybeSingle();
  const existing = ((data as { provider_metadata?: Record<string, unknown> | null } | null)?.provider_metadata ?? {}) as Record<string, unknown>;
  const { error } = await supabase
    .from('call_sessions')
    .update({ provider_metadata: { ...existing, ...meta } })
    .eq('id', callSessionId);
  if (error) logger.error('Failed to save keypad metadata', { callSessionId, error });
}

/**
 * Right after the leg leaves the conference the media path is still re-settling and the first tone is often lost,
 * so lead with a 1 s pause ("ww").
 */
export function toneSequence(digits: string): string {
  return `ww${digits.toLowerCase()}`;
}

export async function clearKeypadMetadata(callSessionId: string): Promise<void> {
  const { data } = await supabase.from('call_sessions').select('provider_metadata').eq('id', callSessionId).maybeSingle();
  const existing = { ...(((data as { provider_metadata?: Record<string, unknown> | null } | null)?.provider_metadata) ?? {}) };
  delete existing.keypad_conference;
  delete existing.ai_call_sid;
  await supabase.from('call_sessions').update({ provider_metadata: existing }).eq('id', callSessionId);
}

export async function redirectCall(callSid: string, twiml: string): Promise<void> {
  await twilio().calls(callSid).update({ twiml });
}

export type PressKeysResult = { ok: true } | { ok: false; reason: 'not_available' | 'invalid_digits' | 'failed'; error?: string };

/** Play DTMF to the carrier: step its leg out of the conference, play the tones, rejoin. */
export async function pressKeys(callSessionId: string, digits: string): Promise<PressKeysResult> {
  if (!KEYPAD_DIGITS.test(digits)) return { ok: false, reason: 'invalid_digits' };
  const { carrierSid, meta } = await loadSession(callSessionId);
  if (!carrierSid || !meta.keypad_conference) return { ok: false, reason: 'not_available' };
  if (config.VOICE_MODE !== 'live') return { ok: true };
  try {
    await twilio()
      .calls(carrierSid)
      .update({ twiml: carrierConferenceTwiml(meta.keypad_conference, meta.time_limit_seconds ?? 3600, toneSequence(digits)) });
    return { ok: true };
  } catch (err) {
    logger.error('Keypad press failed', { callSessionId, twilioCallSid: carrierSid, error: err, errorCategory: 'twilio_api' });
    return { ok: false, reason: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

/** End the mission's conference (hangs up whoever is still in it). Safe to call when there is none. */
export async function endKeypadConference(room: string): Promise<void> {
  if (config.VOICE_MODE !== 'live') return;
  try {
    const conferences = await twilio().conferences.list({ friendlyName: room, status: 'in-progress', limit: 5 });
    await Promise.all(conferences.map((c) => twilio().conferences(c.sid).update({ status: 'completed' })));
  } catch (err) {
    logger.warn('Could not end keypad conference', { room, errorMessage: err instanceof Error ? err.message : String(err) });
  }
}

/** Conference name for a session, if that call was connected in keypad mode. */
export async function keypadConferenceFor(callSessionId: string): Promise<string | null> {
  const { meta } = await loadSession(callSessionId);
  return meta.keypad_conference ?? null;
}
