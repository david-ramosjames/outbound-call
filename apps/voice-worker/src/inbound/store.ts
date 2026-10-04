import {
  emptyContractState,
  newIntakeState,
  resolveAgentInstructions,
  resolveInboundConfig,
  type AgentInstructions,
  type AuditEventInput,
  type InboundConfig,
  type InboundIntakeState,
} from '@outbound-call/shared';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';

// ---------- Settings ----------

let cache: { at: number; value: { config: InboundConfig; instructions: AgentInstructions; instructionsVersion: number | null } } | null = null;
const CACHE_MS = 10_000;

export async function loadInboundSettings(force = false) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const [{ data: settings, error: settingsError }, { data: active }] = await Promise.all([
    supabase.from('inbound_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('inbound_agent_instructions').select('version, content').eq('is_active', true).maybeSingle(),
  ]);
  if (settingsError) {
    // Table missing (migration not run) resolves to all-defaults, i.e. inbound disabled.
    logger.warn('Inbound settings unavailable; using defaults', { errorMessage: settingsError.message });
  }

  const value = {
    config: resolveInboundConfig(settings),
    instructions: resolveAgentInstructions(active?.content),
    instructionsVersion: (active?.version as number | undefined) ?? null,
  };
  cache = { at: Date.now(), value };
  return value;
}

// ---------- Calls ----------

export interface InboundCallRow {
  id: string;
  twilio_call_sid: string | null;
  xai_call_id: string | null;
  from_number: string | null;
  to_number: string | null;
  status: string;
  language: string;
  business_status: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
}

export async function getInboundCall(callId: string): Promise<InboundCallRow | null> {
  const { data } = await supabase.from('inbound_calls').select('*').eq('id', callId).maybeSingle();
  return (data as InboundCallRow | null) ?? null;
}

export async function getInboundCallBySid(sid: string): Promise<InboundCallRow | null> {
  const { data } = await supabase.from('inbound_calls').select('*').eq('twilio_call_sid', sid).maybeSingle();
  return (data as InboundCallRow | null) ?? null;
}

export async function updateInboundCall(callId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('inbound_calls').update(patch).eq('id', callId);
  if (error) logger.error('Failed to update inbound call', { inboundCallId: callId, errorMessage: error.message });
}

export async function createInboundCallWithIntake(input: {
  twilioCallSid: string | null;
  from: string | null;
  to: string | null;
  forwardedFrom: string | null;
  businessStatus: string;
  simulated?: boolean;
}): Promise<{ callId: string; intakeId: string } | null> {
  const { data: call, error } = await supabase
    .from('inbound_calls')
    .insert({
      twilio_call_sid: input.twilioCallSid,
      from_number: input.from,
      to_number: input.to,
      forwarded_from: input.forwardedFrom,
      business_status: input.businessStatus,
      simulated: input.simulated ?? false,
      status: 'ringing',
    })
    .select('id')
    .single();
  if (error || !call) {
    logger.error('Failed to create inbound call', { errorMessage: error?.message });
    return null;
  }

  const state = newIntakeState({ intakeId: 'pending', callId: call.id, callerIdNumber: input.from });
  const { data: intake, error: intakeError } = await supabase
    .from('inbound_intakes')
    .insert({ call_id: call.id, status: 'active', phone: null, state })
    .select('id')
    .single();
  if (intakeError || !intake) {
    logger.error('Failed to create inbound intake', { inboundCallId: call.id, errorMessage: intakeError?.message });
    return null;
  }
  await supabase
    .from('inbound_intakes')
    .update({ state: { ...state, intakeId: intake.id } })
    .eq('id', intake.id);
  return { callId: call.id, intakeId: intake.id };
}

// ---------- Intakes ----------

export async function loadIntakeForCall(callId: string): Promise<InboundIntakeState | null> {
  const { data } = await supabase
    .from('inbound_intakes')
    .select('id, state')
    .eq('call_id', callId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return hydrateState(data.id as string, callId, data.state);
}

export async function loadIntakeById(intakeId: string): Promise<InboundIntakeState | null> {
  const { data } = await supabase.from('inbound_intakes').select('id, call_id, state').eq('id', intakeId).maybeSingle();
  if (!data) return null;
  return hydrateState(data.id as string, (data.call_id as string) ?? '', data.state);
}

function hydrateState(intakeId: string, callId: string, raw: unknown): InboundIntakeState {
  const base = newIntakeState({ intakeId, callId });
  const s = (raw ?? {}) as Partial<InboundIntakeState>;
  return {
    ...base,
    ...s,
    intakeId,
    callId,
    facts: s.facts ?? {},
    contract: { ...emptyContractState(), ...(s.contract ?? {}) },
    transfers: s.transfers ?? [],
    callbacks: s.callbacks ?? [],
    smsSent: s.smsSent ?? [],
    highPriorityReasons: s.highPriorityReasons ?? [],
    needsReviewReasons: s.needsReviewReasons ?? [],
  };
}

function contractStatus(state: InboundIntakeState): string {
  if (state.contract.signed) return 'signed';
  if (state.contract.closedReason) return state.contract.closedReason;
  if (state.contract.viewed) return 'opened';
  if (state.contract.sent) return 'sent';
  if (state.contract.lastError) return 'failed';
  return 'none';
}

export async function saveIntakeState(state: InboundIntakeState, extra: Record<string, unknown> = {}): Promise<void> {
  const f = state.facts;
  const { error } = await supabase
    .from('inbound_intakes')
    .update({
      status: state.status,
      caller_type: f.caller_type ?? null,
      caller_name: f.caller_name ?? null,
      phone: f.phone ?? state.callerIdNumber ?? null,
      email: f.email ?? null,
      language: state.language,
      case_type: f.case_type ?? null,
      incident_date: f.incident_date ?? null,
      incident_state: f.incident_state ?? null,
      qualification_result: state.qualification?.result ?? null,
      qualification_reasons: state.qualification?.reasons ?? [],
      high_priority: state.highPriority || state.qualification?.result === 'high_priority',
      high_priority_reasons: state.highPriorityReasons,
      needs_review_reasons: state.needsReviewReasons,
      recommended_next_action: state.recommendedNextAction,
      can_send_contract: state.qualification?.canSendContract ?? false,
      contract_status: contractStatus(state),
      contract_provider: state.contract.provider,
      contract_external_id: state.contract.externalId,
      contract_sent_at: state.contract.sentAt,
      contract_signed_at: state.contract.signedAt,
      callback_requested: state.callbacks.length > 0,
      facts: f,
      state,
      ...extra,
    })
    .eq('id', state.intakeId);
  if (error) logger.error('Failed to save intake state', { intakeId: state.intakeId, errorMessage: error.message });
}

export async function insertCallbackRequests(state: InboundIntakeState, fromIndex: number): Promise<number> {
  const rows = state.callbacks.slice(fromIndex).map((c) => ({
    intake_id: state.intakeId,
    call_id: state.callId || null,
    priority: c.priority,
    reason: c.reason,
    preferred_time: c.preferredTime,
    phone: c.phone,
  }));
  if (rows.length === 0) return fromIndex;
  const { error } = await supabase.from('inbound_callback_requests').insert(rows);
  if (error) {
    logger.error('Failed to insert callback requests', { intakeId: state.intakeId, errorMessage: error.message });
    return fromIndex;
  }
  return state.callbacks.length;
}

// ---------- Audit ----------

export async function writeAudit(
  ids: { callId?: string | null; intakeId?: string | null },
  event: AuditEventInput,
): Promise<void> {
  const { error } = await supabase.from('inbound_audit_events').insert({
    call_id: ids.callId || null,
    intake_id: ids.intakeId || null,
    event_type: event.type,
    actor: event.actor,
    event_data: event.data ?? {},
  });
  if (error) logger.error('Failed to write inbound audit event', { eventType: event.type, errorMessage: error.message });
}

// ---------- Transcript ----------

export async function saveTranscript(callId: string, speaker: 'caller' | 'agent' | 'system', text: string, language: string): Promise<void> {
  const { error } = await supabase.from('inbound_transcript_segments').insert({ call_id: callId, speaker, text, language });
  if (error) logger.error('Failed to save inbound transcript', { inboundCallId: callId, errorMessage: error.message });
}
