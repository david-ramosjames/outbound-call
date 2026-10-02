import { logger } from '../utils/logger.js';
import { INBOUND_CALL_HEADER, INBOUND_RESUME_HEADER } from './telephony.js';
import { InboundVoiceSession } from './voice-session.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function headerValues(payload: Record<string, unknown>): Array<[string, string]> {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const raw = data.sip_headers ?? payload.sip_headers;
  if (Array.isArray(raw)) {
    return raw
      .filter((h): h is { name: string; value: unknown } => Boolean(h && typeof h === 'object' && 'name' in h))
      .map((h) => [String(h.name), String(h.value ?? '')]);
  }
  if (raw && typeof raw === 'object') return Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v)]);
  return [];
}

function findParam(entries: Array<[string, string]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of entries) if (k.toLowerCase() === lower && v) return v;
  // Twilio forwards custom headers as SIP URI query params (To / Request-URI).
  for (const [, v] of entries) {
    const q = v.indexOf('?');
    if (q === -1) continue;
    const params = new URLSearchParams(v.slice(q + 1).split(/[;>\s]/)[0] ?? '');
    for (const [pk, pv] of params) if (pk.toLowerCase() === lower && pv) return pv;
  }
  return undefined;
}

/**
 * Inbound calls are tagged with X-Inbound-Call-Id when bridged to xAI.
 * Returns true if the call was inbound (and handled), false to let the outbound flow continue untouched.
 */
export function tryHandleInboundXaiCall(payload: Record<string, unknown>, xaiCallId: string): boolean {
  const entries = headerValues(payload);
  const rawId = findParam(entries, INBOUND_CALL_HEADER);
  const callId = rawId?.match(UUID)?.[0];
  if (!callId) return false;

  const resumed = findParam(entries, INBOUND_RESUME_HEADER) === '1';
  logger.info('xAI call routed to inbound intake', { inboundCallId: callId, xaiCallId, resumed });

  const session = new InboundVoiceSession(callId, xaiCallId, resumed);
  session.start().catch((err) => {
    logger.error('Failed to start inbound voice session', { inboundCallId: callId, xaiCallId, error: err, errorCategory: 'xai_session' });
  });
  return true;
}
