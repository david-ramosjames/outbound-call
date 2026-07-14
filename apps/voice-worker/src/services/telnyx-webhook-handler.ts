import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { canTransitionStatus } from '@outbound-call/shared';
import type { CallStatus } from '@outbound-call/shared';
import { XaiVoiceSession } from './xai-voice-session.js';

interface TelnyxWebhookPayload {
  data: {
    event_type: string;
    id: string;
    occurred_at: string;
    payload: {
      call_control_id: string;
      call_session_id?: string;
      call_leg_id?: string;
      client_state?: string;
      from?: string;
      to?: string;
      state?: string;
      hangup_cause?: string;
      hangup_source?: string;
      sip_hangup_cause?: string;
      result?: string;
      [key: string]: unknown;
    };
  };
  meta?: {
    attempt?: number;
    delivered_to?: string;
  };
}

interface ClientState {
  correlationToken: string;
  missionId: string;
  callSessionId: string;
}

function decodeClientState(encoded?: string): ClientState | null {
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

const TELNYX_EVENT_TO_STATUS: Record<string, CallStatus> = {
  'call.initiated': 'dialing',
  'call.ringing': 'ringing',
  'call.answered': 'answered',
  'call.hangup': 'completed',
};

const TELNYX_EVENT_TO_INTERNAL: Record<string, string> = {
  'call.initiated': 'telnyx_call_initiated',
  'call.ringing': 'ringing',
  'call.answered': 'answered',
  'call.bridged': 'xai_sip_call_received',
  'call.hangup': 'call_completed',
  'call.machine.detection': 'answered',
};

export function verifyTelnyxSignature(
  rawBody: Buffer,
  signature: string,
  timestamp: string
): boolean {
  try {
    const publicKey = config.TELNYX_PUBLIC_KEY;
    const signedPayload = `${timestamp}|${rawBody.toString('utf-8')}`;
    const verifier = crypto.createVerify('sha256');
    verifier.update(signedPayload);
    return verifier.verify(
      `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`,
      signature,
      'base64'
    );
  } catch (err) {
    logger.warn('Telnyx signature verification failed', {
      error: err,
      errorCategory: 'webhook_auth',
    });
    return false;
  }
}

export async function handleTelnyxWebhook(
  payload: TelnyxWebhookPayload
): Promise<void> {
  const event = payload.data;
  const eventType = event.event_type;
  const externalEventId = event.id;
  const callControlId = event.payload.call_control_id;

  logger.info('Telnyx webhook received', {
    eventType,
    telnyxCallSessionId: event.payload.call_session_id,
  });

  // Decode client_state
  const clientState = decodeClientState(event.payload.client_state);
  let missionId = clientState?.missionId;
  let callSessionId = clientState?.callSessionId;

  // Fallback: look up by call_control_id if client_state is missing
  if (!missionId && callControlId) {
    const { data: session } = await supabase
      .from('call_sessions')
      .select('call_mission_id, id')
      .eq('telnyx_call_control_id', callControlId)
      .single();

    if (session) {
      missionId = session.call_mission_id;
      callSessionId = session.id;
    }
  }

  if (!missionId) {
    logger.warn('Could not correlate Telnyx webhook to a mission', {
      eventType,
      telnyxCallSessionId: event.payload.call_session_id,
    });
    return;
  }

  const logCtx = { missionId, callSessionId, eventType };

  // Idempotency: check if we've already processed this external event
  if (externalEventId) {
    const { data: existing } = await supabase
      .from('call_events')
      .select('id')
      .eq('source', 'telnyx')
      .eq('external_event_id', externalEventId)
      .maybeSingle();

    if (existing) {
      logger.info('Duplicate Telnyx event, skipping', logCtx);
      return;
    }
  }

  // Update call_sessions with Telnyx IDs
  if (callSessionId) {
    const sessionUpdate: Record<string, unknown> = {};
    if (event.payload.call_session_id) {
      sessionUpdate.telnyx_call_session_id = event.payload.call_session_id;
    }
    if (event.payload.call_leg_id) {
      sessionUpdate.telnyx_call_leg_id = event.payload.call_leg_id;
    }
    if (Object.keys(sessionUpdate).length > 0) {
      await supabase
        .from('call_sessions')
        .update(sessionUpdate)
        .eq('id', callSessionId);
    }
  }

  // Save the event
  const internalType = TELNYX_EVENT_TO_INTERNAL[eventType] ?? eventType;
  await supabase.from('call_events').insert({
    id: uuidv4(),
    call_mission_id: missionId,
    call_session_id: callSessionId,
    source: 'telnyx',
    external_event_id: externalEventId,
    event_type: internalType,
    provider_status: event.payload.state ?? null,
    sequence_number: Date.now(),
    event_payload: {
      telnyxEventType: eventType,
      callControlId,
      from: event.payload.from,
      to: event.payload.to,
    },
    occurred_at: event.occurred_at,
    processed_at: new Date().toISOString(),
  });

  // Handle specific event types
  switch (eventType) {
    case 'call.initiated':
    case 'call.ringing':
      await transitionMissionStatus(
        missionId,
        TELNYX_EVENT_TO_STATUS[eventType]!,
        logCtx
      );
      break;

    case 'call.answered':
      await transitionMissionStatus(missionId, 'answered', logCtx);
      await supabase
        .from('call_missions')
        .update({ answered_at: new Date().toISOString() })
        .eq('id', missionId);
      await bridgeToXai(missionId, callSessionId!, callControlId);
      break;

    case 'call.bridged':
      logger.info('Call bridged to xAI SIP', logCtx);
      break;

    case 'call.hangup':
      await handleHangup(missionId, callSessionId!, event.payload, logCtx);
      break;

    case 'call.machine.detection':
      await handleMachineDetection(
        missionId,
        callSessionId!,
        event.payload,
        logCtx
      );
      break;

    default:
      logger.info(`Unhandled Telnyx event: ${eventType}`, logCtx);
  }
}

async function transitionMissionStatus(
  missionId: string,
  newStatus: CallStatus,
  logCtx: Record<string, unknown>
): Promise<void> {
  const { data: mission } = await supabase
    .from('call_missions')
    .select('status')
    .eq('id', missionId)
    .single();

  if (!mission) return;

  const currentStatus = mission.status as CallStatus;
  if (!canTransitionStatus(currentStatus, newStatus)) {
    logger.info(
      `Status transition blocked: ${currentStatus} -> ${newStatus}`,
      logCtx
    );
    return;
  }

  await supabase
    .from('call_missions')
    .update({ status: newStatus })
    .eq('id', missionId);

  logger.info(`Mission status -> ${newStatus}`, logCtx);
}

async function bridgeToXai(
  missionId: string,
  callSessionId: string,
  callControlId: string
): Promise<void> {
  logger.info('Initiating xAI SIP bridge', { missionId, callSessionId });

  try {
    const { data: mission } = await supabase
      .from('call_missions')
      .select('*')
      .eq('id', missionId)
      .single();

    if (!mission) {
      logger.error('Mission not found for xAI bridge', { missionId });
      return;
    }

    await transitionMissionStatus(missionId, 'in_progress', {
      missionId,
      callSessionId,
    });

    const session = new XaiVoiceSession(missionId, callSessionId);
    await session.connect(missionId, mission);
  } catch (err) {
    logger.error('Failed to bridge to xAI', {
      missionId,
      callSessionId,
      error: err,
      errorCategory: 'xai_bridge',
    });
  }
}

async function handleHangup(
  missionId: string,
  callSessionId: string,
  payload: TelnyxWebhookPayload['data']['payload'],
  logCtx: Record<string, unknown>
): Promise<void> {
  const hangupCause = payload.hangup_cause ?? 'unknown';
  const hangupSource = payload.hangup_source ?? 'unknown';

  logger.info('Call hangup', {
    ...logCtx,
    status: hangupCause,
  });

  const isNormalHangup =
    hangupCause === 'normal_clearing' || hangupCause === 'normal';
  const finalStatus: CallStatus = isNormalHangup ? 'completed' : 'failed';

  await supabase
    .from('call_sessions')
    .update({
      ended_at: new Date().toISOString(),
      disconnect_reason: `${hangupSource}: ${hangupCause}`,
    })
    .eq('id', callSessionId);

  await supabase
    .from('call_missions')
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      ...(finalStatus === 'failed'
        ? { failure_reason: `Hangup: ${hangupCause} (${hangupSource})` }
        : {}),
    })
    .eq('id', missionId);
}

async function handleMachineDetection(
  missionId: string,
  callSessionId: string,
  payload: TelnyxWebhookPayload['data']['payload'],
  logCtx: Record<string, unknown>
): Promise<void> {
  const result = payload.result;
  logger.info('Machine detection result', { ...logCtx, status: result });

  if (result === 'machine') {
    await supabase.from('call_events').insert({
      id: uuidv4(),
      call_mission_id: missionId,
      call_session_id: callSessionId,
      source: 'telnyx',
      event_type: 'answered',
      event_payload: { machineDetection: 'voicemail' },
      occurred_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      sequence_number: Date.now(),
    });
  }
}
