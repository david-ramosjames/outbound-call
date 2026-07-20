import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { canTransitionStatus } from '@outbound-call/shared';
import type { CallStatus } from '@outbound-call/shared';

interface TwilioStatusCallback {
  CallSid: string;
  AccountSid: string;
  From: string;
  To: string;
  CallStatus: string;
  Direction: string;
  CallDuration?: string;
  SipResponseCode?: string;
  CorrelationToken?: string;
  [key: string]: unknown;
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

const TWILIO_STATUS_TO_CALL_STATUS: Record<string, CallStatus> = {
  'queued': 'initiating',
  'initiated': 'dialing',
  'ringing': 'ringing',
  'in-progress': 'answered',
  'completed': 'completed',
  'busy': 'failed',
  'no-answer': 'failed',
  'canceled': 'cancelled',
  'failed': 'failed',
};

const TWILIO_STATUS_TO_EVENT: Record<string, string> = {
  'queued': 'telnyx_call_requested',
  'initiated': 'telnyx_call_initiated',
  'ringing': 'ringing',
  'in-progress': 'answered',
  'completed': 'call_completed',
  'busy': 'call_failed',
  'no-answer': 'call_failed',
  'canceled': 'call_failed',
  'failed': 'call_failed',
};

export async function handleTwilioWebhook(
  params: TwilioStatusCallback
): Promise<string> {
  const callSid = params.CallSid;
  const callStatus = params.CallStatus;
  const externalEventId = `${callSid}:${callStatus}:${Date.now()}`;

  logger.info('Twilio webhook received', {
    eventType: callStatus,
    twilioCallSid: callSid,
  });

  // Look up mission by CallSid
  let missionId: string | undefined;
  let callSessionId: string | undefined;

  // Try correlation token from SIP header passthrough
  const correlationParam = params.CorrelationToken;
  if (correlationParam) {
    const clientState = decodeClientState(correlationParam);
    missionId = clientState?.missionId;
    callSessionId = clientState?.callSessionId;
  }

  // Fallback: look up by Twilio CallSid in call_sessions
  if (!missionId && callSid) {
    const { data: session } = await supabase
      .from('call_sessions')
      .select('call_mission_id, id')
      .eq('telnyx_call_control_id', callSid)
      .single();

    if (session) {
      missionId = session.call_mission_id;
      callSessionId = session.id;
    }
  }

  if (!missionId) {
    logger.warn('Could not correlate Twilio webhook to a mission', {
      eventType: callStatus,
      twilioCallSid: callSid,
    });
    return '';
  }

  const logCtx = { missionId, callSessionId, eventType: callStatus };

  // Idempotency: skip if already processed
  const { data: existing } = await supabase
    .from('call_events')
    .select('id')
    .eq('source', 'telnyx')
    .eq('external_event_id', externalEventId)
    .maybeSingle();

  if (existing) {
    logger.info('Duplicate Twilio event, skipping', logCtx);
    return '';
  }

  // Save event
  const internalType = TWILIO_STATUS_TO_EVENT[callStatus] ?? callStatus;
  await supabase.from('call_events').insert({
    id: uuidv4(),
    call_mission_id: missionId,
    call_session_id: callSessionId,
    source: 'telnyx',
    external_event_id: externalEventId,
    event_type: internalType,
    provider_status: callStatus,
    sequence_number: Date.now(),
    event_payload: {
      twilioCallStatus: callStatus,
      callSid,
      from: params.From,
      to: params.To,
      sipResponseCode: params.SipResponseCode,
    },
    occurred_at: new Date().toISOString(),
    processed_at: new Date().toISOString(),
  });

  // Handle status transitions
  const newStatus = TWILIO_STATUS_TO_CALL_STATUS[callStatus];
  if (newStatus) {
    await transitionMissionStatus(missionId, newStatus, logCtx);
  }

  // Handle specific events
  switch (callStatus) {
    case 'in-progress':
      await supabase
        .from('call_missions')
        .update({ answered_at: new Date().toISOString() })
        .eq('id', missionId);
      // Audio is bridged to xAI via TwiML <Dial><Sip>. The voice session
      // starts when xAI posts realtime.call.incoming — do not open a
      // premature agent_id WebSocket here.
      await transitionMissionStatus(missionId, 'answered', {
        missionId,
        callSessionId,
      });
      break;

    case 'completed':
      await handleCompleted(missionId, callSessionId!, params);
      break;

    case 'busy':
    case 'no-answer':
    case 'failed':
      await handleFailed(missionId, callSessionId!, callStatus, params);
      break;
  }

  return '';
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

async function handleCompleted(
  missionId: string,
  callSessionId: string,
  params: TwilioStatusCallback
): Promise<void> {
  const duration = params.CallDuration
    ? parseInt(params.CallDuration, 10)
    : null;

  await supabase
    .from('call_sessions')
    .update({
      ended_at: new Date().toISOString(),
      disconnect_reason: 'normal_clearing',
    })
    .eq('id', callSessionId);

  await supabase
    .from('call_missions')
    .update({
      completed_at: new Date().toISOString(),
      ...(duration !== null ? { duration_seconds: duration } : {}),
    })
    .eq('id', missionId);
}

async function handleFailed(
  missionId: string,
  callSessionId: string,
  status: string,
  params: TwilioStatusCallback
): Promise<void> {
  const reason = `Twilio status: ${status}` +
    (params.SipResponseCode ? ` (SIP ${params.SipResponseCode})` : '');

  await supabase
    .from('call_sessions')
    .update({
      ended_at: new Date().toISOString(),
      disconnect_reason: reason,
    })
    .eq('id', callSessionId);

  await supabase
    .from('call_missions')
    .update({
      status: 'failed' as CallStatus,
      completed_at: new Date().toISOString(),
      failure_reason: reason,
    })
    .eq('id', missionId);
}
