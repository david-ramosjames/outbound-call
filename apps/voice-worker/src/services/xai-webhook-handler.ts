import crypto from 'node:crypto';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { XaiVoiceSession } from './xai-voice-session.js';
import { mapDbMissionToCallMission } from './map-mission.js';

interface XaiSipHeader {
  name: string;
  value: string;
}

interface XaiSipWebhookPayload {
  object?: string;
  id?: string;
  type?: string;
  /** Legacy / incorrect field some older code expected */
  event?: string;
  created_at?: number;
  data?: {
    call_id?: string;
    sip_headers?: XaiSipHeader[];
    metadata?: Record<string, unknown>;
  };
  call_id?: string;
  sip_headers?: XaiSipHeader[] | Record<string, string>;
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Verify Standard Webhooks v1 signatures (webhook-id / webhook-timestamp / webhook-signature)
 * as used by xAI Direct SIP. Also accepts a legacy hex HMAC body signature if provided.
 */
export function verifyXaiSignature(
  rawBody: string,
  signature: string,
  webhookId?: string,
  webhookTimestamp?: string,
): boolean {
  try {
    const isStandardFormat = /(?:^|\s)v1,/.test(signature);

    if (isStandardFormat) {
      if (!webhookId || !webhookTimestamp) {
        logger.warn('xAI webhook has v1 signature but missing id/timestamp headers', {
          hasWebhookId: Boolean(webhookId),
          hasWebhookTimestamp: Boolean(webhookTimestamp),
          errorCategory: 'webhook_auth',
        });
        return false;
      }

      return verifyStandardWebhookSignature(
        rawBody,
        signature,
        webhookId,
        webhookTimestamp,
      );
    }

    const expected = crypto
      .createHmac('sha256', config.XAI_SIP_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || sigBuf.length === 0) return false;

    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (err) {
    logger.warn('xAI signature verification threw', {
      error: err,
      errorCategory: 'webhook_auth',
    });
    return false;
  }
}

/** Safe metadata for diagnosing secret/env issues without logging the secret. */
export function webhookSecretDiagnostics(secret = config.XAI_SIP_WEBHOOK_SECRET): Record<string, unknown> {
  const trimmed = secret.trim();
  const key = decodeWebhookSecret(trimmed);
  return {
    secretLen: trimmed.length,
    secretPrefix: trimmed.slice(0, 6),
    startsWithWhsec: trimmed.startsWith('whsec_'),
    endsWithSlash: trimmed.endsWith('/'),
    containsPlus: trimmed.includes('+'),
    containsSpace: /\s/.test(trimmed),
    decodedKeyBytes: key.length,
    fingerprint: crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 12),
  };
}

function verifyStandardWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookId: string,
  webhookTimestamp: string,
): boolean {
  const normalizedSecret = normalizeWebhookSecret(config.XAI_SIP_WEBHOOK_SECRET);
  const secretKeys = uniqueBuffers([
    decodeWebhookSecret(normalizedSecret),
    // Fallbacks for common Railway/env mangling of + and trailing /
    decodeWebhookSecret(normalizedSecret.replace(/ /g, '+')),
    decodeWebhookSecret(
      normalizedSecret.endsWith('/') ? normalizedSecret : `${normalizedSecret}/`,
    ),
  ]);

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;

  const candidates = signatureHeader
    .split(/[\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice(3));

  for (const key of secretKeys) {
    const expectedB64 = crypto
      .createHmac('sha256', key)
      .update(signedContent, 'utf8')
      .digest('base64');
    const expectedBytes = Buffer.from(expectedB64, 'base64');

    for (const candidate of candidates) {
      try {
        const candidateBytes = Buffer.from(candidate, 'base64');
        if (
          candidateBytes.length > 0 &&
          candidateBytes.length === expectedBytes.length &&
          crypto.timingSafeEqual(candidateBytes, expectedBytes)
        ) {
          return true;
        }
      } catch {
        // try next
      }
    }
  }

  logger.warn('xAI standard webhook signature mismatch', {
    ...webhookSecretDiagnostics(normalizedSecret),
    bodyBytes: Buffer.byteLength(rawBody, 'utf8'),
    candidateCount: candidates.length,
    webhookIdPrefix: webhookId.slice(0, 12),
    errorCategory: 'webhook_auth',
  });

  return false;
}

function normalizeWebhookSecret(secret: string): string {
  // Trim whitespace/newlines; restore + if a URL-decoder turned it into a space
  let s = secret.trim();
  if (s.startsWith('whsec_') && /\s/.test(s.slice('whsec_'.length))) {
    s = `whsec_${s.slice('whsec_'.length).replace(/ /g, '+')}`;
  }
  return s;
}

function decodeWebhookSecret(secret: string): Buffer {
  const normalized = normalizeWebhookSecret(secret);
  if (normalized.startsWith('whsec_')) {
    return Buffer.from(normalized.slice('whsec_'.length), 'base64');
  }
  try {
    const decoded = Buffer.from(normalized, 'base64');
    if (
      decoded.length > 0 &&
      decoded.toString('base64').replace(/=+$/, '') === normalized.replace(/=+$/, '')
    ) {
      return decoded;
    }
  } catch {
    // fall through
  }
  return Buffer.from(normalized, 'utf8');
}

function uniqueBuffers(bufs: Buffer[]): Buffer[] {
  const seen = new Set<string>();
  const out: Buffer[] = [];
  for (const b of bufs) {
    const hex = b.toString('hex');
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push(b);
  }
  return out;
}

export async function handleXaiWebhook(
  payload: XaiSipWebhookPayload
): Promise<void> {
  const eventType = payload.type ?? payload.event;
  const xaiCallId = payload.data?.call_id ?? payload.call_id;

  logger.info('xAI SIP webhook received', {
    eventType,
    xaiCallId,
    webhookEventId: payload.id,
  });

  if (eventType !== 'realtime.call.incoming') {
    logger.info(`Ignoring xAI event: ${eventType ?? 'unknown'}`, { xaiCallId });
    return;
  }

  if (!xaiCallId) {
    logger.error('xAI incoming webhook missing call_id', {
      eventType,
      payloadKeys: Object.keys(payload),
    });
    return;
  }

  const missionId = await correlateXaiCall(payload);

  if (!missionId) {
    logger.warn('Could not correlate xAI call to a mission', {
      xaiCallId,
      eventType,
      sipHeaders: extractSipHeaderMap(payload),
    });
    return;
  }

  const { data: session } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('call_mission_id', missionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!session) {
    logger.error('No call session found for mission', {
      missionId,
      xaiCallId,
    });
    return;
  }

  // Avoid starting a second WebSocket if we already joined this SIP call
  if (session.xai_call_id === xaiCallId && session.xai_connection_status === 'connected') {
    logger.info('xAI session already connected for this call', {
      missionId,
      callSessionId: session.id,
      xaiCallId,
    });
    return;
  }

  await supabase
    .from('call_sessions')
    .update({
      xai_call_id: xaiCallId,
      xai_connection_status: 'connecting',
    })
    .eq('id', session.id);

  logger.info('xAI call correlated to mission', {
    missionId,
    callSessionId: session.id,
    xaiCallId,
  });

  const { data: missionRow } = await supabase
    .from('call_missions')
    .select('*')
    .eq('id', missionId)
    .single();

  if (!missionRow) {
    logger.error('Mission not found for xAI session', { missionId });
    return;
  }

  const mission = mapDbMissionToCallMission(
    missionRow as Record<string, unknown>,
  );

  await supabase
    .from('call_missions')
    .update({ status: 'in_progress' })
    .eq('id', missionId);

  const voiceSession = new XaiVoiceSession(missionId, session.id);
  voiceSession.connect(xaiCallId, mission).catch((err) => {
    logger.error('Failed to start xAI voice session', {
      missionId,
      callSessionId: session.id,
      xaiCallId,
      error: err,
      errorCategory: 'xai_session',
    });
  });
}

function extractSipHeaderMap(
  payload: XaiSipWebhookPayload
): Record<string, string> {
  const headers = payload.data?.sip_headers ?? payload.sip_headers;
  if (!headers) return {};

  if (Array.isArray(headers)) {
    const map: Record<string, string> = {};
    for (const h of headers) {
      if (!h?.name || h.value == null) continue;
      map[h.name] = String(h.value);
      map[h.name.toLowerCase()] = String(h.value);
    }
    return map;
  }

  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    map[k] = v;
    map[k.toLowerCase()] = v;
  }
  return map;
}

function headerValueCI(
  headers: Record<string, string>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const v = headers[name] ?? headers[name.toLowerCase()];
    if (v) return v;
  }
  // Last resort: scan keys case-insensitively
  const lowerNames = names.map((n) => n.toLowerCase());
  for (const [k, v] of Object.entries(headers)) {
    if (lowerNames.includes(k.toLowerCase()) && v) return v;
  }
  return undefined;
}

/** Pull X-Correlation-Token / X-Mission-Id from SIP header map or embedded URIs. */
function extractCorrelationToken(
  headers: Record<string, string>,
): string | undefined {
  const direct = headerValueCI(
    headers,
    'X-Correlation-Token',
    'X-Mission-Id',
    'X-Mission-ID',
  );
  if (direct) {
    // Sometimes value is a full SIP URI / angle-addr; pull UUID if present
    const uuid = direct.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    return uuid?.[0] ?? direct.trim();
  }

  // Twilio puts custom headers into the Request-URI / To as ?X-Foo=bar
  for (const key of ['To', 'to', 'Request-URI', 'request-uri', 'Call-ID', 'call-id']) {
    const raw = headers[key];
    if (!raw) continue;
    const fromQuery = tokenFromSipUri(raw);
    if (fromQuery) return fromQuery;
  }

  // Scan every header value for our query params
  for (const value of Object.values(headers)) {
    const fromQuery = tokenFromSipUri(value);
    if (fromQuery) return fromQuery;
  }

  return undefined;
}

function tokenFromSipUri(raw: string): string | undefined {
  try {
    const qIndex = raw.indexOf('?');
    if (qIndex === -1) return undefined;
    const query = raw.slice(qIndex + 1).split(/[;>\s]/)[0] ?? '';
    const params = new URLSearchParams(query);
    const token =
      params.get('X-Correlation-Token') ??
      params.get('x-correlation-token') ??
      params.get('X-Mission-Id') ??
      params.get('x-mission-id');
    return token || undefined;
  } catch {
    return undefined;
  }
}

async function correlateXaiCall(
  payload: XaiSipWebhookPayload
): Promise<string | null> {
  const sipHeaders = extractSipHeaderMap(payload);
  const correlationToken = extractCorrelationToken(sipHeaders);

  if (correlationToken) {
    const { data: byToken } = await supabase
      .from('call_missions')
      .select('id')
      .eq('correlation_token', correlationToken)
      .maybeSingle();

    if (byToken) {
      logger.info('Correlated xAI call via SIP token', {
        missionId: byToken.id,
        correlationToken,
      });
      return byToken.id;
    }

    const { data: byId } = await supabase
      .from('call_missions')
      .select('id')
      .eq('id', correlationToken)
      .maybeSingle();

    if (byId) {
      logger.info('Correlated xAI call via mission id header', {
        missionId: byId.id,
      });
      return byId.id;
    }
  }

  // Fallback: most recent live mission (webhook often races ahead of Twilio "answered")
  const recent = await findRecentLiveMission();
  if (recent) {
    logger.info('Correlated xAI call via recent live mission fallback', {
      missionId: recent,
      hadSipToken: Boolean(correlationToken),
      sipHeaderNames: Object.keys(sipHeaders),
    });
    return recent;
  }

  // One short retry — Twilio status may land a few hundred ms later
  await sleep(750);
  const retried = await findRecentLiveMission();
  if (retried) {
    logger.info('Correlated xAI call via retry fallback', {
      missionId: retried,
    });
    return retried;
  }

  logger.warn('Correlation exhausted', {
    sipHeaderNames: Object.keys(sipHeaders),
    sipHeaderSample: JSON.stringify(sipHeaders).slice(0, 800),
    correlationToken: correlationToken ?? null,
  });

  return null;
}

async function findRecentLiveMission(): Promise<string | null> {
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('call_missions')
    .select('id, status, started_at, created_at')
    .in('status', [
      'initiating',
      'dialing',
      'ringing',
      'answered',
      'in_progress',
    ])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
