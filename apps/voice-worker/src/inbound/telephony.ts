import crypto from 'node:crypto';
import type { Request } from 'express';
import Twilio from 'twilio';
import type { TransferTarget } from '@outbound-call/shared';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let client: ReturnType<typeof Twilio> | null = null;
function twilioClient() {
  client ??= Twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  return client;
}

export const INBOUND_CALL_HEADER = 'X-Inbound-Call-Id';
export const INBOUND_RESUME_HEADER = 'X-Inbound-Resume';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function appendSipParams(sipUri: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  if (!qs) return sipUri;
  return `${sipUri}${sipUri.includes('?') ? '&' : '?'}${qs}`;
}

function workerUrl(path: string, query: Record<string, string> = {}): string {
  const qs = new URLSearchParams(query).toString();
  return `${config.VOICE_WORKER_BASE_URL}${path}${qs ? `?${qs}` : ''}`;
}

export function twiml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${body}\n</Response>`;
}

/** Bridge the caller to Grok Voice over SIP. If the AI leg can't connect, the action URL falls back to a human. */
export function sipBridgeTwiml(inboundCallId: string, resume = false): string {
  const sipUri = appendSipParams(config.XAI_SIP_URI, {
    [INBOUND_CALL_HEADER]: inboundCallId,
    ...(resume ? { [INBOUND_RESUME_HEADER]: '1' } : {}),
  });
  const action = workerUrl('/webhooks/inbound/twilio/ai-ended', { callId: inboundCallId });
  return twiml(
    `  <Dial answerOnBridge="true" timeout="30" action="${escapeXml(action)}" method="POST">\n    <Sip>${escapeXml(sipUri)}</Sip>\n  </Dial>`,
  );
}

/** What callers get when the AI is off or unavailable: forward to the office line, or a message. */
export function fallbackTwiml(routing: { disabled_behavior: string; primary_transfer_number: string; disabled_message: string }): string {
  const primary = routing.primary_transfer_number.trim();
  if (routing.disabled_behavior === 'forward_to_primary' && primary) {
    return twiml(`  <Dial timeout="30">\n    <Number>${escapeXml(primary)}</Number>\n  </Dial>\n  <Say>${escapeXml(routing.disabled_message)}</Say>`);
  }
  return twiml(`  <Say>${escapeXml(routing.disabled_message)}</Say>`);
}

export function transferDialTwiml(input: {
  inboundCallId: string;
  target: TransferTarget;
  timeoutSeconds: number;
  callerId: string | null;
  preamble?: string;
}): string {
  const action = workerUrl('/webhooks/inbound/twilio/transfer-result', {
    callId: input.inboundCallId,
    label: input.target.label,
  });
  const whisper = workerUrl('/webhooks/inbound/twilio/whisper', { callId: input.inboundCallId });
  const callerIdAttr = input.callerId ? ` callerId="${escapeXml(input.callerId)}"` : '';
  return twiml(
    [
      input.preamble ? `  <Say>${escapeXml(input.preamble)}</Say>` : '',
      `  <Dial timeout="${input.timeoutSeconds}" answerOnBridge="true" action="${escapeXml(action)}" method="POST"${callerIdAttr}>`,
      `    <Number url="${escapeXml(whisper)}" method="POST">${escapeXml(input.target.number)}</Number>`,
      '  </Dial>',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

/** Redirect a live call (currently bridged to the AI) to a human. */
export async function redirectToHuman(twilioCallSid: string, twimlBody: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (config.VOICE_MODE !== 'live') {
    logger.mock('Inbound transfer redirect skipped (mock mode)', { twilioCallSid });
    return { ok: false, error: 'Transfers are unavailable in mock mode' };
  }
  try {
    await twilioClient().calls(twilioCallSid).update({ twiml: twimlBody });
    return { ok: true };
  } catch (err) {
    logger.error('Inbound transfer redirect failed', { twilioCallSid, error: err, errorCategory: 'twilio_api' });
    return { ok: false, error: err instanceof Error ? err.message : 'Twilio update failed' };
  }
}

export async function hangUpCall(twilioCallSid: string): Promise<void> {
  if (config.VOICE_MODE !== 'live') return;
  try {
    await twilioClient().calls(twilioCallSid).update({ status: 'completed' });
  } catch (err) {
    logger.warn('Inbound hangup failed', { twilioCallSid, errorMessage: err instanceof Error ? err.message : String(err) });
  }
}

export async function sendSms(from: string, to: string, body: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (config.VOICE_MODE !== 'live') {
    logger.mock('Inbound SMS skipped (mock mode)', { to: to.slice(-4) });
    return { ok: true, id: 'mock-sms' };
  }
  if (!from) return { ok: false, error: 'No SMS from-number configured' };
  try {
    const msg = await twilioClient().messages.create({ from, to: toE164(to), body });
    return { ok: true, id: msg.sid };
  } catch (err) {
    logger.error('Inbound SMS failed', { error: err, errorCategory: 'twilio_api' });
    return { ok: false, error: err instanceof Error ? err.message : 'SMS failed' };
  }
}

export function toE164(phone: string): string {
  const digits = phone.split(/ext/i)[0]!.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

/** Twilio request signature check (same algorithm as the outbound webhook). */
export function validateTwilioRequest(req: Request): boolean {
  if (config.VOICE_MODE !== 'live') return true;
  const signature = req.headers['x-twilio-signature'] as string | undefined;
  if (!signature) return false;
  const url = `${config.VOICE_WORKER_BASE_URL}${req.originalUrl}`;
  const params = (req.body ?? {}) as Record<string, string>;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const computed = crypto.createHmac('sha1', config.TWILIO_AUTH_TOKEN).update(data).digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(computed);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
