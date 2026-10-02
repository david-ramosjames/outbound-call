import { normalizePhoneCapture } from '../utils/capture-validation.js';
import { computeAvailableActions, type AvailableActions, type TransferTarget } from './actions.js';
import { getBusinessStatus, type BusinessStatus } from './business-hours.js';
import type { AgentInstructions, InboundConfig } from './config.js';
import { applyFactUpdates, currentIntakeStage, detectUrgentIndicators, getMissingFields, URGENT_INDICATOR_LABELS } from './intake-engine.js';
import { evaluateQualification } from './qualification.js';
import type { InboundIntakeState } from './state.js';
import { inboundToolArgSchemas, isInboundToolName, type InboundToolName } from './tools.js';
import type { AuditActor, AuditEventType, BusinessStatusValue, InboundIntakeStatus } from './types.js';

export interface AuditEventInput {
  type: AuditEventType;
  actor: AuditActor;
  data?: Record<string, unknown>;
}

export type TransferStartResult =
  | { ok: true; /** Simulation only: the immediate outcome of the transfer. */ connected?: boolean; failureReason?: string }
  | { ok: false; error: string };

export interface InboundTelephony {
  startTransfer(target: TransferTarget, state: InboundIntakeState, reason: string): Promise<TransferStartResult>;
  sendSms(to: string, body: string): Promise<{ ok: true; id?: string } | { ok: false; error: string }>;
}

export interface ContractSendResult {
  ok: boolean;
  provider: string;
  externalId?: string | null;
  error?: string;
}

export interface InboundContractService {
  sendAgreement(state: InboundIntakeState, toPhone: string): Promise<ContractSendResult>;
}

/** Everything the executor needs from the outside world. Live calls use DB/Twilio; the Test Agent uses in-memory fakes. */
export interface InboundRuntime {
  config: InboundConfig;
  instructions: AgentInstructions;
  now(): Date;
  businessOverride?: BusinessStatusValue | null;
  audit(event: AuditEventInput): Promise<void>;
  telephony: InboundTelephony;
  contracts: InboundContractService;
  /** Called after every tool that changes state. */
  persist(state: InboundIntakeState): Promise<void>;
}

export interface ToolExecution {
  name: string;
  ok: boolean;
  output: Record<string, unknown>;
  /** Set when the agent should hang up / hand off after speaking. */
  endCall?: boolean;
  transferStarted?: boolean;
}

export function businessStatusFor(runtime: InboundRuntime): BusinessStatus {
  return getBusinessStatus(runtime.config.business_hours, runtime.now(), runtime.businessOverride ?? null);
}

export function availableActionsFor(state: InboundIntakeState, runtime: InboundRuntime): AvailableActions {
  return computeAvailableActions(state, runtime.config, businessStatusFor(runtime), runtime.now());
}

export function deriveIntakeStatus(state: InboundIntakeState): InboundIntakeStatus {
  if (state.contract.signed) return 'contract_signed';
  if (state.contract.sent) return 'contract_sent';
  if (state.transfers.some((t) => t.success === true)) return 'transferred';
  const type = state.facts.caller_type;
  if (type === 'existing_client') return 'existing_client';
  if (type === 'other') return 'other';
  const q = state.qualification?.result;
  if (q === 'not_qualified') return 'declined';
  if (q === 'qualified' || q === 'high_priority') return 'qualified';
  if (q === 'needs_review' || state.needsReviewReasons.length > 0) return 'needs_review';
  return state.completed ? 'incomplete' : 'active';
}

function reject(name: string, error: string): ToolExecution {
  return { name, ok: false, output: { ok: false, error } };
}

function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
}

/** Re-run the engines after facts change; records urgency and qualification transitions. */
async function refreshDerivedState(state: InboundIntakeState, runtime: InboundRuntime): Promise<void> {
  const now = runtime.now();
  const urgent = detectUrgentIndicators(state.facts, now);
  const newUrgent = urgent.filter((u) => !state.highPriorityReasons.includes(URGENT_INDICATOR_LABELS[u]));
  if (newUrgent.length > 0) {
    state.highPriority = true;
    state.highPriorityReasons.push(...newUrgent.map((u) => URGENT_INDICATOR_LABELS[u]));
    await runtime.audit({ type: 'HIGH_PRIORITY_DETECTED', actor: 'SYSTEM', data: { indicators: newUrgent } });
  }

  if (runtime.config.flags.qualification_enabled && state.facts.caller_type === 'new_potential_client') {
    const previous = state.qualification?.result ?? null;
    state.qualification = evaluateQualification(state.facts, runtime.config.qualification, now);
    if (previous !== null && previous !== state.qualification.result) {
      await runtime.audit({
        type: 'QUALIFICATION_CHANGED',
        actor: 'SYSTEM',
        data: { from: previous, to: state.qualification.result, reasons: state.qualification.reasons },
      });
    }
  }

  state.recommendedNextAction = availableActionsFor(state, runtime).recommendedNextAction;
  state.status = deriveIntakeStatus(state);
}

function nextStepPayload(state: InboundIntakeState, runtime: InboundRuntime) {
  const actions = availableActionsFor(state, runtime);
  const missing = getMissingFields(state.facts, runtime.now());
  return {
    stage: currentIntakeStage(state.facts, runtime.now()),
    urgent: actions.urgent,
    still_needed: missing.missing.slice(0, 4).map((m) => m.hint),
    next_step: actions.recommendedNextAction,
    guidance: actions.guidance,
  };
}

export async function executeInboundTool(
  name: string,
  rawArgs: unknown,
  state: InboundIntakeState,
  runtime: InboundRuntime,
): Promise<ToolExecution> {
  if (!isInboundToolName(name)) {
    await runtime.audit({ type: 'TOOL_REJECTED', actor: 'SYSTEM', data: { tool: name, error: 'unknown tool' } });
    return reject(name, `Unknown tool ${name}`);
  }
  const parsed = inboundToolArgSchemas[name].safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    await runtime.audit({ type: 'TOOL_REJECTED', actor: 'SYSTEM', data: { tool: name, error } });
    return reject(name, `Invalid arguments: ${error}`);
  }
  if (state.completed && !['end_call', 'request_callback', 'send_sms', 'get_business_status'].includes(name)) {
    return reject(name, 'Intake is already completed. Close the call.');
  }
  return run(name, parsed.data as never, state, runtime);
}

async function run(name: InboundToolName, args: Record<string, any>, state: InboundIntakeState, runtime: InboundRuntime): Promise<ToolExecution> {
  const { config, instructions } = runtime;

  switch (name) {
    case 'save_contact_information': {
      const updates: Record<string, unknown> = {};
      if (args.caller_name) updates.caller_name = args.caller_name;
      if (args.email) updates.email = args.email;
      if (args.phone) updates.phone = args.phone;
      else if (args.use_caller_id_number && state.callerIdNumber) updates.phone = state.callerIdNumber;
      if (args.preferred_language) updates.preferred_language = args.preferred_language;
      const result = applyFactUpdates(state.facts, updates);
      state.facts = result.facts;
      if (result.changed.length) {
        await runtime.audit({ type: 'INTAKE_UPDATED', actor: 'AI', data: { fields: result.changed } });
      }
      await refreshDerivedState(state, runtime);
      await runtime.persist(state);
      return {
        name,
        ok: result.rejected.length === 0,
        output: {
          ok: result.rejected.length === 0,
          saved: result.changed,
          problems: result.rejected,
          ...(result.rejected.some((r) => r.key === 'phone') ? { ask: 'Ask them to repeat the full 10-digit number.' } : {}),
          ...nextStepPayload(state, runtime),
        },
      };
    }

    case 'update_intake': {
      const result = applyFactUpdates(state.facts, args.facts as Record<string, unknown>);
      state.facts = result.facts;
      if (result.changed.length) {
        await runtime.audit({ type: 'INTAKE_UPDATED', actor: 'AI', data: { fields: result.changed } });
      }
      await refreshDerivedState(state, runtime);
      await runtime.persist(state);
      return {
        name,
        ok: true,
        output: { ok: true, saved: result.changed, problems: result.rejected, ...nextStepPayload(state, runtime) },
      };
    }

    case 'record_case_fact': {
      const key = String(args.key).toLowerCase().replace(/[^a-z0-9_]/g, '_');
      state.facts = applyFactUpdates(state.facts, { case_specific: { [key]: args.value } }).facts;
      await runtime.audit({ type: 'INTAKE_UPDATED', actor: 'AI', data: { fields: [`case_specific.${key}`] } });
      await runtime.persist(state);
      return { name, ok: true, output: { ok: true, saved: key } };
    }

    case 'record_declined_field': {
      state.facts = applyFactUpdates(state.facts, { declined_to_provide: [args.key] }).facts;
      await runtime.audit({ type: 'INTAKE_UPDATED', actor: 'AI', data: { declined: args.key } });
      await refreshDerivedState(state, runtime);
      await runtime.persist(state);
      return { name, ok: true, output: { ok: true, note: 'Do not ask for this again.', ...nextStepPayload(state, runtime) } };
    }

    case 'get_missing_intake_fields': {
      const report = getMissingFields(state.facts, runtime.now());
      return {
        name,
        ok: true,
        output: {
          ok: true,
          mode: report.mode,
          missing: report.missing.map((m) => ({ item: m.label, ask_about: m.hint })),
          already_known: Object.keys(state.facts).filter((k) => k !== 'declined_to_provide' && k !== 'case_specific'),
          declined: report.declined,
        },
      };
    }

    case 'evaluate_qualification': {
      if (!config.flags.qualification_enabled) {
        return { name, ok: true, output: { ok: true, next_step: 'request_callback', guidance: 'Take a callback request; the team will review.' } };
      }
      if (state.facts.caller_type !== 'new_potential_client') {
        return { name, ok: true, output: { ok: true, ...nextStepPayload(state, runtime) } };
      }
      state.qualification = evaluateQualification(state.facts, config.qualification, runtime.now());
      await runtime.audit({
        type: 'QUALIFICATION_RUN',
        actor: 'SYSTEM',
        data: {
          result: state.qualification.result,
          reasons: state.qualification.reasons,
          matched_rules: state.qualification.matchedRuleIds,
          can_send_contract: state.qualification.canSendContract,
        },
      });
      await refreshDerivedState(state, runtime);
      await runtime.persist(state);
      const actions = availableActionsFor(state, runtime);
      return {
        name,
        ok: true,
        output: {
          ok: true,
          next_step: actions.recommendedNextAction,
          guidance: actions.guidance,
          can_transfer: actions.canTransfer,
          can_offer_agreement: actions.canOfferContract,
          note: 'This evaluation is internal. Never tell the caller about criteria, scores, or reasons.',
        },
      };
    }

    case 'get_business_status': {
      const b = businessStatusFor(runtime);
      return {
        name,
        ok: true,
        output: { ok: true, office_open: b.status === 'business_hours', status: b.status, local_time: b.localTime, next_open: b.nextOpenPhrase },
      };
    }

    case 'get_available_actions': {
      const a = availableActionsFor(state, runtime);
      return {
        name,
        ok: true,
        output: {
          ok: true,
          office_open: a.businessStatus === 'business_hours',
          can_transfer: a.canTransfer,
          transfer_note: a.canTransfer ? null : a.transferBlockedReason,
          can_offer_agreement: a.canOfferContract,
          can_text_caller: a.canSendSms,
          should_request_callback: a.shouldRequestCallback,
          callback_priority: a.callbackPriority,
          next_step: a.recommendedNextAction,
          guidance: a.guidance,
        },
      };
    }

    case 'transfer_to_human': {
      const a = availableActionsFor(state, runtime);
      if (!a.canTransfer || !a.nextTransferTarget) {
        await runtime.audit({ type: 'TOOL_REJECTED', actor: 'SYSTEM', data: { tool: name, error: a.transferBlockedReason } });
        return {
          name,
          ok: false,
          output: {
            ok: false,
            error: 'Transfer is not available right now.',
            guidance: 'Do not mention a transfer again. Offer a callback instead (request_callback).',
          },
        };
      }
      const target = a.nextTransferTarget;
      state.transfers.push({ destination: target.number, label: target.label, startedAt: runtime.now().toISOString(), success: null, failureReason: null });
      const attempt = state.transfers[state.transfers.length - 1]!;
      await runtime.audit({ type: 'TRANSFER_ATTEMPTED', actor: 'AI', data: { target: target.label, reason: args.reason } });

      const res = await runtime.telephony.startTransfer(target, state, args.reason);
      if (!res.ok) {
        attempt.success = false;
        attempt.failureReason = res.error;
        await runtime.audit({ type: 'TRANSFER_FAILED', actor: 'SYSTEM', data: { target: target.label, error: res.error } });
        await refreshDerivedState(state, runtime);
        await runtime.persist(state);
        return {
          name,
          ok: false,
          output: { ok: false, say: instructions.transfer_failed_language, ...nextStepPayload(state, runtime) },
        };
      }

      if (res.connected === undefined) {
        // Live call: the phone system now owns the caller. The outcome arrives via webhook.
        state.transferInProgress = true;
        state.status = deriveIntakeStatus(state);
        await runtime.persist(state);
        return {
          name,
          ok: true,
          transferStarted: true,
          output: { ok: true, transferring: true, guidance: 'Say only a brief "one moment" if anything. The call is being connected.' },
        };
      }

      attempt.success = res.connected;
      attempt.failureReason = res.connected ? null : res.failureReason ?? 'no_answer';
      await runtime.audit({
        type: res.connected ? 'TRANSFER_SUCCEEDED' : 'TRANSFER_FAILED',
        actor: 'SYSTEM',
        data: { target: target.label, ...(res.connected ? {} : { reason: attempt.failureReason }) },
      });
      await refreshDerivedState(state, runtime);
      await runtime.persist(state);
      return res.connected
        ? { name, ok: true, transferStarted: true, endCall: true, output: { ok: true, connected: true } }
        : { name, ok: false, output: { ok: false, say: instructions.transfer_failed_language, ...nextStepPayload(state, runtime) } };
    }

    case 'request_callback': {
      let phone: string | null = state.facts.phone ?? state.callerIdNumber;
      if (args.phone) {
        const p = normalizePhoneCapture(args.phone);
        if (!p.ok) return reject(name, p.problem);
        phone = p.value;
      }
      const a = availableActionsFor(state, runtime);
      const priority = args.urgent || a.callbackPriority === 'urgent' ? 'urgent' : 'normal';
      state.callbacks.push({
        priority,
        reason: args.reason,
        preferredTime: args.preferred_time ?? null,
        phone,
        requestedAt: runtime.now().toISOString(),
      });
      await runtime.audit({ type: 'CALLBACK_REQUESTED', actor: 'AI', data: { priority, reason: args.reason, preferred_time: args.preferred_time ?? null } });
      await runtime.persist(state);
      const b = businessStatusFor(runtime);
      return {
        name,
        ok: true,
        output: {
          ok: true,
          priority,
          tell_caller:
            b.status === 'business_hours'
              ? 'Someone from the team will call them back.'
              : `Someone from the team will call them back${b.nextOpenPhrase ? ` ${b.nextOpenPhrase}` : ' when the office opens'}.`,
          note: 'Do not promise a specific person or an exact time.',
        },
      };
    }

    case 'send_engagement_agreement': {
      const a = availableActionsFor(state, runtime);
      if (!a.canOfferContract) {
        await runtime.audit({ type: 'TOOL_REJECTED', actor: 'SYSTEM', data: { tool: name, error: a.contractBlockedReason } });
        return {
          name,
          ok: false,
          output: { ok: false, error: 'An agreement cannot be sent right now.', guidance: 'Do not mention the agreement again. Let them know the team will follow up.' },
        };
      }
      const to = state.facts.phone ?? state.callerIdNumber!;
      state.contract.offered = true;
      state.contract.offeredAt ??= runtime.now().toISOString();
      await runtime.audit({ type: 'CONTRACT_OFFERED', actor: 'AI', data: { accepted: true } });

      const res = await runtime.contracts.sendAgreement(state, to);
      if (!res.ok) {
        state.contract.lastError = res.error ?? 'unknown error';
        await runtime.audit({ type: 'CONTRACT_SEND_FAILED', actor: 'SYSTEM', data: { provider: res.provider, error: res.error } });
        state.needsReviewReasons.push('Engagement agreement failed to send');
        await refreshDerivedState(state, runtime);
        await runtime.persist(state);
        return {
          name,
          ok: false,
          output: {
            ok: false,
            say: "I'm sorry, I wasn't able to send that just now. I've let the team know and someone will follow up with you to get it to you.",
            guidance: 'Call request_callback with urgent priority. Do not try to send again.',
          },
        };
      }
      state.contract.sent = true;
      state.contract.provider = res.provider;
      state.contract.externalId = res.externalId ?? null;
      state.contract.sentAt = runtime.now().toISOString();
      state.contract.lastError = null;
      await runtime.audit({ type: 'CONTRACT_SENT', actor: 'SYSTEM', data: { provider: res.provider, external_id: res.externalId ?? null } });
      await refreshDerivedState(state, runtime);
      await runtime.persist(state);
      return {
        name,
        ok: true,
        output: { ok: true, sent: true, tell_caller: 'The agreement was texted to them. They can review and sign it on their phone, and call with any questions.' },
      };
    }

    case 'send_sms': {
      const to = state.facts.phone ?? state.callerIdNumber;
      if (!config.flags.sms_enabled || !to) {
        return reject(name, 'Text messages are not available. Do not offer a text.');
      }
      const b = businessStatusFor(runtime);
      const body =
        args.template === 'office_contact_info'
          ? 'Ramos James Law: thank you for calling. You can reach our office at this number during business hours.'
          : `Ramos James Law: we received your message and someone from our team will call you back${b.status === 'business_hours' ? ' soon' : b.nextOpenPhrase ? ` ${b.nextOpenPhrase}` : ''}.`;
      const res = await runtime.telephony.sendSms(to, body);
      if (!res.ok) {
        await runtime.audit({ type: 'SMS_FAILED', actor: 'SYSTEM', data: { template: args.template, error: res.error } });
        return reject(name, 'The text could not be sent.');
      }
      state.smsSent.push({ type: args.template, at: runtime.now().toISOString() });
      await runtime.audit({ type: 'SMS_SENT', actor: 'SYSTEM', data: { template: args.template } });
      await runtime.persist(state);
      return { name, ok: true, output: { ok: true } };
    }

    case 'mark_high_priority': {
      state.highPriority = true;
      if (!state.highPriorityReasons.includes(args.reason)) state.highPriorityReasons.push(args.reason);
      await runtime.audit({ type: 'HIGH_PRIORITY_DETECTED', actor: 'AI', data: { reason: args.reason } });
      await refreshDerivedState(state, runtime);
      await runtime.persist(state);
      return { name, ok: true, output: { ok: true, ...nextStepPayload(state, runtime) } };
    }

    case 'mark_needs_review': {
      if (!state.needsReviewReasons.includes(args.reason)) state.needsReviewReasons.push(args.reason);
      await runtime.audit({ type: 'NEEDS_REVIEW_MARKED', actor: 'AI', data: { reason: args.reason } });
      state.status = deriveIntakeStatus(state);
      await runtime.persist(state);
      return { name, ok: true, output: { ok: true } };
    }

    case 'set_language': {
      if (args.language === 'es' && !config.flags.spanish_enabled) {
        return reject(name, 'Spanish is not enabled. Apologize briefly, continue simply in English, and request a callback from a Spanish-speaking team member.');
      }
      if (state.language !== args.language) {
        const from = state.language;
        state.language = args.language;
        state.facts = applyFactUpdates(state.facts, { preferred_language: args.language }).facts;
        await runtime.audit({ type: 'LANGUAGE_CHANGED', actor: 'AI', data: { from, to: args.language } });
        await runtime.persist(state);
      }
      return { name, ok: true, output: { ok: true, language: args.language, guidance: args.language === 'es' ? 'Continúe en español.' : 'Continue in English.' } };
    }

    case 'complete_intake': {
      if (state.facts.caller_type === 'new_potential_client' && config.flags.qualification_enabled) {
        state.qualification = evaluateQualification(state.facts, config.qualification, runtime.now());
        await runtime.audit({ type: 'QUALIFICATION_RUN', actor: 'SYSTEM', data: { result: state.qualification.result, reasons: state.qualification.reasons, final: true } });
      }
      state.completed = true;
      state.status = deriveIntakeStatus(state);
      await runtime.audit({ type: 'INTAKE_COMPLETED', actor: 'AI', data: { status: state.status, note: args.summary_for_staff ?? null } });
      await runtime.persist(state);
      const b = businessStatusFor(runtime);
      const closing =
        state.qualification?.result === 'not_qualified'
          ? instructions.decline_language
          : b.status === 'business_hours'
            ? 'Thank them, confirm the team has their information and will be in touch, and say goodbye.'
            : fillTemplate(instructions.after_hours_language, { next_open: b.nextOpenPhrase ?? 'when the office opens' });
      return { name, ok: true, output: { ok: true, closing_guidance: closing, then: 'Say goodbye, then call end_call.' } };
    }

    case 'end_call': {
      await runtime.audit({ type: 'CALL_COMPLETED', actor: 'AI', data: { reason: args.reason ?? null } });
      return { name, ok: true, endCall: true, output: { ok: true } };
    }
  }
}
