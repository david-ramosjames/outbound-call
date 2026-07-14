import { v4 as uuidv4 } from 'uuid';
import { Telnyx } from 'telnyx';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { canTransitionStatus } from '@outbound-call/shared';
import type { CallMission, CallStatus } from '@outbound-call/shared';
import { MockCallProvider } from './mock-call-provider.js';

const telnyx = new Telnyx({ apiKey: config.TELNYX_API_KEY });

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
  const provider = config.VOICE_MODE === 'mock' ? 'mock' : 'telnyx';

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

  // 7. Live mode: Telnyx call
  try {
    const clientState = Buffer.from(
      JSON.stringify({ correlationToken, missionId, callSessionId })
    ).toString('base64');

    const call = await telnyx.calls.dial({
      to: mission.destination_phone,
      from: config.TELNYX_CALLER_ID_NUMBER,
      connection_id: config.TELNYX_CONNECTION_ID,
      client_state: clientState,
      sip_transport_protocol: 'TLS',
      webhook_url: `${config.VOICE_WORKER_BASE_URL}/webhooks/telnyx/calls`,
    });

    const callControlId = call.data?.call_control_id ?? null;

    // 8. Save telnyx_call_control_id
    if (callControlId) {
      await supabase
        .from('call_sessions')
        .update({
          telnyx_call_control_id: callControlId,
          started_at: new Date().toISOString(),
        })
        .eq('id', callSessionId);
    }

    // 9. Update status to 'dialing'
    await updateMissionStatus(missionId, 'dialing');
    await createSystemEvent(missionId, callSessionId, 'telnyx_call_initiated', {
      callControlId,
      to: mission.destination_phone,
    });

    logger.info('Telnyx call initiated, status -> dialing', {
      ...logCtx,
      callSessionId,
    });

    return { success: true, callSessionId };
  } catch (err) {
    logger.error('Telnyx call initiation failed', {
      ...logCtx,
      callSessionId,
      error: err,
      errorCategory: 'telnyx_api',
    });

    await updateMissionStatus(missionId, 'failed', {
      failure_reason:
        err instanceof Error ? err.message : 'Telnyx call initiation failed',
    });
    await createSystemEvent(missionId, callSessionId, 'call_failed', {
      reason: err instanceof Error ? err.message : 'Unknown error',
    });

    return { success: false, error: 'Telnyx call initiation failed' };
  }
}
