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
    if (webhookId && webhookTimestamp && signature.includes('v1,')) {
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
    if (sigBuf.length !== expBuf.length) return false;

    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (err) {
    logger.warn('xAI signature verification failed', {
      error: err,
      errorCategory: 'webhook_auth',
    });
    return false;
  }
}

function verifyStandardWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookId: string,
  webhookTimestamp: string,
): boolean {
  const secret = decodeWebhookSecret(config.XAI_SIP_WEBHOOK_SECRET);
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedContent)
    .digest('base64');

  const candidates = signatureHeader
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice(3));

  return candidates.some((candidate) => {
    try {
      const a = Buffer.from(candidate);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

function decodeWebhookSecret(secret: string): Buffer {
  if (secret.startsWith('whsec_')) {
    return Buffer.from(secret.slice('whsec_'.length), 'base64');
  }
  // Prefer base64 when it looks like it; otherwise treat as raw utf8
  try {
    const decoded = Buffer.from(secret, 'base64');
    if (decoded.length > 0 && decoded.toString('base64').replace(/=+$/, '') === secret.replace(/=+$/, '')) {
      return decoded;
    }
  } catch {
    // fall through
  }
  return Buffer.from(secret, 'utf8');
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
