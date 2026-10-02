import { deriveIntakeStatus, evaluateQualification, formatIntakeSummary } from '@outbound-call/shared';
import { logger } from '../utils/logger.js';
import { getInboundCall, loadInboundSettings, loadIntakeForCall, saveIntakeState, updateInboundCall, writeAudit } from './store.js';

const finalized = new Set<string>();

/**
 * Close out an inbound call: final qualification, staff summary, call record.
 * Safe to call more than once (session end, Twilio status callback, transfer result).
 */
export async function finalizeInboundCall(callId: string, reason: string, opts: { force?: boolean } = {}): Promise<void> {
  if (finalized.has(callId)) return;
  const call = await getInboundCall(callId);
  if (!call) return;
  if (call.ended_at && !opts.force) {
    finalized.add(callId);
    return;
  }

  const state = await loadIntakeForCall(callId);
  if (!state) return;
  if (state.transferInProgress && !opts.force) {
    logger.info('Inbound finalize deferred: transfer in progress', { inboundCallId: callId, reason });
    return;
  }
  finalized.add(callId);

  const { config } = await loadInboundSettings();
  if (state.facts.caller_type === 'new_potential_client' && config.flags.qualification_enabled) {
    state.qualification = evaluateQualification(state.facts, config.qualification);
  }
  state.transferInProgress = false;
  state.status = deriveIntakeStatus(state);
  if (state.status === 'active') state.status = 'incomplete';

  const endedAt = new Date();
  const duration = Math.max(0, Math.round((endedAt.getTime() - Date.parse(call.answered_at ?? call.started_at)) / 1000));
  const transferred = state.transfers.some((t) => t.success === true);

  await saveIntakeState(state, { summary: formatIntakeSummary(state), completed_at: endedAt.toISOString() });
  await updateInboundCall(callId, {
    status: transferred ? 'transferred' : 'completed',
    ended_at: endedAt.toISOString(),
    duration_seconds: duration,
    end_reason: reason,
    language: state.language,
  });
  await writeAudit({ callId, intakeId: state.intakeId }, { type: 'CALL_COMPLETED', actor: 'SYSTEM', data: { reason, status: state.status, duration_seconds: duration } });
  logger.info('Inbound call finalized', { inboundCallId: callId, status: state.status, reason });
}
