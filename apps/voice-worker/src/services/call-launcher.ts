import { v4 as uuidv4 } from 'uuid';
import Twilio from 'twilio';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { canTransitionStatus } from '@outbound-call/shared';
import type { CallMission, CallStatus } from '@outbound-call/shared';
import { MockCallProvider } from './mock-call-provider.js';

const twilioClient = Twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

async function updateMissionStatus(
  missionId: string,
  status: CallStatus,
  extra?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from('call_missions')
    .update({ status, ...extra })
    .eq('id', missionId);

  if (error) {
    logger.error('Failed to update mission status', {
      missionId,
      status,
      error,
    });
    throw new Error(`Failed to update mission status to ${status}`);
  }
}

async function createSystemEvent(
  missionId: string,
  callSessionId: string | null,
  eventType: string,
  payload?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('call_events').insert({
    id: uuidv4(),
    call_mission_id: missionId,
    call_session_id: callSessionId,
    source: 'system',
    event_type: eventType,
    event_payload: payload ?? null,
    occurred_at: new Date().toISOString(),
    processed_at: new Date().toISOString(),
    sequence_number: Date.now(),
  });

  if (error) {
    logger.error('Failed to create system event', {
      missionId,
      eventType,
      error,
    });
  }
}

export async function launchCall(missionId: string): Promise<{
  success: boolean;
  callSessionId?: string;
  error?: string;
}> {
  const logCtx = { missionId };

  // 1. Fetch mission
  const { data: mission, error: fetchError } = await supabase
    .from('call_missions')
    .select('*')
    .eq('id', missionId)
    .single();

  if (fetchError || !mission) {
    logger.error('Mission not found', { ...logCtx, error: fetchError });
    return { success: false, error: 'Mission not found' };
  }

  // 2. Validate status is 'queued'
  if (mission.status !== 'queued') {
    logger.warn('Mission not in queued status', {
      ...logCtx,
      status: mission.status,
    });
    return {
      success: false,
      error: `Mission is in "${mission.status}" status, expected "queued"`,
    };
  }

  // 3. Update status to 'initiating'
  if (!canTransitionStatus(mission.status as CallStatus, 'initiating')) {
    return { success: false, error: 'Invalid status transition to initiating' };
  }

  await updateMissionStatus(missionId, 'initiating', {
    started_at: new Date().toISOString(),
  });
  await createSystemEvent(missionId, null, 'telnyx_call_requested', {
    voiceMode: config.VOICE_MODE,
  });

  logger.info('Mission status -> initiating', logCtx);

  // 4. Generate correlation token
  const correlationToken = mission.correlation_token ?? uuidv4();
  if (!mission.correlation_token) {
    await supabase
      .from('call_missions')
      .update({ correlation_token: correlationToken })
      .eq('id', missionId);
  }

  // 5. Create call_sessions record
  const callSessionId = uuidv4();
  const provider = config.VOICE_MODE === 'mock' ? 'mock' : 'twilio';

  const { error: sessionError } = await supabase.from('call_sessions').insert({
    id: callSessionId,
    call_mission_id: missionId,
    provider,
    xai_connection_status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (sessionError) {
    logger.error('Failed to create call session', {
      ...logCtx,
      error: sessionError,
    });
    await updateMissionStatus(missionId, 'failed', {
      failure_reason: 'Failed to create call session',
    });
    return { success: false, error: 'Failed to create call session' };
  }

  logger.info('Call session created', {
    ...logCtx,
    callSessionId,
  });

  // 6. Delegate based on VOICE_MODE
  if (config.VOICE_MODE === 'mock') {
    logger.mock('Delegating to MockCallProvider', logCtx);
    const mock = new MockCallProvider();
    mock.simulateCall(mission as CallMission, callSessionId).catch((err) => {
      logger.error('Mock call simulation failed', {
        ...logCtx,
        error: err,
      });
    });
    return { success: true, callSessionId };
  }

  // 7. Live mode: Twilio call
  try {
    const clientState = Buffer.from(
      JSON.stringify({ correlationToken, missionId, callSessionId })
    ).toString('base64');

    const statusCallbackUrl = `${config.VOICE_WORKER_BASE_URL}/webhooks/twilio/calls?CorrelationToken=${encodeURIComponent(clientState)}`;

    const call = await twilioClient.calls.create({
      to: mission.destination_phone,
      from: config.TWILIO_PHONE_NUMBER,
      url: `${config.VOICE_WORKER_BASE_URL}/webhooks/twilio/twiml?missionId=${missionId}`,
      statusCallback: statusCallbackUrl,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
    });

    const callSid = call.sid;

    // 8. Save Twilio CallSid (stored in telnyx_call_control_id column for compatibility)
    if (callSid) {
      await supabase
        .from('call_sessions')
        .update({
          telnyx_call_control_id: callSid,
          started_at: new Date().toISOString(),
        })
        .eq('id', callSessionId);
    }

    // 9. Update status to 'dialing'
    await updateMissionStatus(missionId, 'dialing');
    await createSystemEvent(missionId, callSessionId, 'telnyx_call_initiated', {
      callSid,
      to: mission.destination_phone,
    });

    logger.info('Twilio call initiated, status -> dialing', {
      ...logCtx,
      callSessionId,
    });

    return { success: true, callSessionId };
  } catch (err) {
    logger.error('Twilio call initiation failed', {
      ...logCtx,
      callSessionId,
      error: err,
      errorCategory: 'twilio_api',
    });

    await updateMissionStatus(missionId, 'failed', {
      failure_reason:
        err instanceof Error ? err.message : 'Twilio call initiation failed',
    });
    await createSystemEvent(missionId, callSessionId, 'call_failed', {
      reason: err instanceof Error ? err.message : 'Unknown error',
    });

    return { success: false, error: 'Twilio call initiation failed' };
  }
}
