import crypto from 'node:crypto';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { XaiVoiceSession } from './xai-voice-session.js';

interface XaiSipWebhookPayload {
  event: string;
  call_id: string;
  phone_number_id?: string;
  sip_headers?: Record<string, string>;
  timestamp?: string;
  [key: string]: unknown;
}

export function verifyXaiSignature(
  rawBody: string,
  signature: string
): boolean {
  try {
    const expected = crypto
      .createHmac('sha256', config.XAI_SIP_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch (err) {
    logger.warn('xAI signature verification failed', {
      error: err,
      errorCategory: 'webhook_auth',
    });
    return false;
  }
}

export async function handleXaiWebhook(
  payload: XaiSipWebhookPayload
): Promise<void> {
  const { event, call_id: xaiCallId } = payload;

  logger.info('xAI SIP webhook received', {
    eventType: event,
    xaiCallId,
  });

  if (event !== 'realtime.call.incoming') {
    logger.info(`Ignoring xAI event: ${event}`, { xaiCallId });
    return;
  }

  // Correlate with a mission via SIP headers or recent timing
  const missionId = await correlateXaiCall(payload);

  if (!missionId) {
    logger.warn('Could not correlate xAI call to a mission', {
      xaiCallId,
      eventType: event,
    });
    return;
  }

  // Find the active call session for this mission
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

  // Save xai_call_id to call_sessions
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

  // Fetch mission data and trigger XaiVoiceSession
  const { data: mission } = await supabase
    .from('call_missions')
    .select('*')
    .eq('id', missionId)
    .single();

  if (!mission) {
    logger.error('Mission not found for xAI session', { missionId });
    return;
  }

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

async function correlateXaiCall(
  payload: XaiSipWebhookPayload
): Promise<string | null> {
  // Strategy 1: Check SIP headers for correlation token
  const sipHeaders = payload.sip_headers;
  if (sipHeaders) {
    const correlationToken =
      sipHeaders['X-Correlation-Token'] ??
      sipHeaders['x-correlation-token'];

    if (correlationToken) {
      const { data: mission } = await supabase
        .from('call_missions')
        .select('id')
        .eq('correlation_token', correlationToken)
        .single();

      if (mission) return mission.id;
    }
  }

  // Strategy 2: Find the most recent mission in 'answered' or 'in_progress' status
  const { data: recentMission } = await supabase
    .from('call_missions')
    .select('id')
    .in('status', ['answered', 'in_progress'])
    .order('answered_at', { ascending: false })
    .limit(1)
    .single();

  if (recentMission) return recentMission.id;

  return null;
}
