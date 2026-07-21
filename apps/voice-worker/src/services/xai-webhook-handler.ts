import crypto from 'node:crypto';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { XaiVoiceSession } from './xai-voice-session.js';

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

  const { data: mission } = await supabase
    .from('call_missions')
    .select('*')
    .eq('id', missionId)
    .single();

  if (!mission) {
    logger.error('Mission not found for xAI session', { missionId });
    return;
  }

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
    return Object.fromEntries(
      headers
        .filter((h) => h?.name && h?.value != null)
        .map((h) => [h.name, h.value]),
    );
  }

  return headers;
}

async function correlateXaiCall(
  payload: XaiSipWebhookPayload
): Promise<string | null> {
  const sipHeaders = extractSipHeaderMap(payload);

  const correlationToken =
    sipHeaders['X-Correlation-Token'] ??
    sipHeaders['x-correlation-token'] ??
    sipHeaders['X-Mission-Id'] ??
    sipHeaders['x-mission-id'];

  if (correlationToken) {
    const { data: byToken } = await supabase
      .from('call_missions')
      .select('id')
      .eq('correlation_token', correlationToken)
      .maybeSingle();

    if (byToken) return byToken.id;

    // Allow passing mission id directly in the SIP header
    const { data: byId } = await supabase
      .from('call_missions')
      .select('id')
      .eq('id', correlationToken)
      .maybeSingle();

    if (byId) return byId.id;
  }

  // Fallback: most recent answered / in-progress mission (single-call V1)
  const { data: recentMission } = await supabase
    .from('call_missions')
    .select('id')
    .in('status', ['answered', 'in_progress'])
    .order('answered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentMission) return recentMission.id;

  return null;
}
