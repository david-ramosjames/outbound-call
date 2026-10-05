import { normalizePhoneCapture } from '../utils/capture-validation.js';
import { computeAvailableActions, type AvailableActions, type TransferTarget } from './actions.js';
import { getBusinessStatus, type BusinessStatus } from './business-hours.js';
import type { AgentInstructions, ContractDeliveryMethod, InboundConfig } from './config.js';
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

export interface ContractDeliveryRequest {
  delivery: ContractDeliveryMethod;
  phone: string | null;
  email: string | null;
}

export const AGREEMENT_STATUSES = ['sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled', 'unknown'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export interface InboundContractService {
  sendAgreement(state: InboundIntakeState, request: ContractDeliveryRequest): Promise<ContractSendResult>;
  /** Providers that can report signing status (e.g. Sign Flow). */
  getStatus?(state: InboundIntakeState): Promise<{ ok: true; status: AgreementStatus } | { ok: false; error: string }>;
  resend?(state: InboundIntakeState, request: ContractDeliveryRequest): Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * Record a signing status reported by the provider (tool check or webhook). Returns true when
 * anything changed; the caller re-derives status and persists.
 */
export async function applyAgreementStatus(
  state: InboundIntakeState,
  status: AgreementStatus,
  audit: (event: AuditEventInput) => Promise<void>,
  now: Date,
  source: string,
): Promise<boolean> {
  const c = state.contract;
  if (!c.sent || c.signed) return false;
  const at = now.toISOString();
  let changed = false;
  if ((status === 'viewed' || status === 'signed') && !c.viewed) {
    c.viewed = true;
    c.viewedAt = at;
    changed = true;
    if (status === 'viewed') await audit({ type: 'CONTRACT_VIEWED', actor: 'SYSTEM', data: { source } });
  }
  if (status === 'signed') {
    c.signed = true;
    c.signedAt = at;
    c.closedReason = null;
    await audit({ type: 'CONTRACT_SIGNED', actor: 'SYSTEM', data: { source, external_id: c.externalId } });
    return true;
  }
  if ((status === 'declined' || status === 'expired' || status === 'cancelled') && !c.closedReason) {
    c.closedReason = status === 'declined' ? 'declined' : 'expired';
    await audit({ type: 'CONTRACT_DECLINED', actor: 'SYSTEM', data: { source, status } });
    if (!state.needsReviewReasons.includes('Engagement agreement was not signed')) {
      state.needsReviewReasons.push('Engagement agreement was not signed');
    }
    return true;
  }
  return changed;
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

/** Save a spoken email if given; returns a problem when there is still no valid email on file. */
function saveEmailFact(state: InboundIntakeState, spoken: string | undefined): string | null {
  if (spoken) {
    const r = applyFactUpdates(state.facts, { email: spoken });
    if (r.rejected.length) return r.rejected[0]!.problem;
    state.facts = r.facts;
  }
  return state.facts.email ? null : 'No email address on file yet.';
}

export function agreementStatusGuidance(state: InboundIntakeState, canCheck: boolean): string {
  const c = state.contract;
  if (c.signed)
    return 'It is signed. Thank them warmly and let them know the team has their signed agreement and will reach out with next steps. Then make sure a callback is requested if needed, call complete_intake, and close.';
  if (c.closedReason === 'declined')
    return 'They declined to sign in the form. Do not pressure. Ask if they have concerns, note them, and request_callback so someone from the team can talk it through.';
  if (c.closedReason === 'expired')
    return 'That signing link is no longer active. Let them know the team will follow up, and request_callback.';
  if (!canCheck) return 'Signing status cannot be checked on this call. Let them know the team will confirm once it comes through.';
  if (c.viewed)
    return 'They have it open but it is not signed yet. Ask if they have any questions. Remind them to sign and tap the button at the end to finish, then check again.';
  return 'It has not been opened yet. Ask if the message arrived (it can take a minute, and texts or emails sometimes land in spam or filtered messages). Offer to resend, or send it the other way.';
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
  if (state.completed && !['end_call', 'request_callback', 'send_sms', 'get_business_status', 'check_agreement_status'].includes(name)) {
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
          ...(actions.canOfferContract ? { agreement_delivery: actions.contractDelivery } : {}),
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
          ...(a.canOfferContract ? { agreement_delivery: a.contractDelivery } : {}),
          ...(state.contract.sent ? { agreement: { opened: state.contract.viewed, signed: state.contract.signed } } : {}),
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
      const delivery: ContractDeliveryMethod = args.delivery ?? a.contractDelivery[0]!;
      if (!a.contractDelivery.includes(delivery)) {
        return { name, ok: false, output: { ok: false, error: `The agreement cannot be sent by ${delivery === 'sms' ? 'text' : 'email'}.`, agreement_delivery: a.contractDelivery } };
      }
      if (delivery === 'email') {
        const emailProblem = saveEmailFact(state, args.email);
        if (emailProblem) return { name, ok: false, output: { ok: false, error: emailProblem, ask: 'Ask for their email address, spell it back to confirm, then call send_engagement_agreement again with email.' } };
      }
      state.contract.offered = true;
      state.contract.offeredAt ??= runtime.now().toISOString();
      await runtime.audit({ type: 'CONTRACT_OFFERED', actor: 'AI', data: { accepted: true, delivery } });

      const res = await runtime.contracts.sendAgreement(state, {
        delivery,
        phone: state.facts.phone ?? state.callerIdNumber,
        email: state.facts.email ?? null,
      });
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
      state.contract.delivery = delivery;
      state.contract.lastError = null;
      await runtime.audit({ type: 'CONTRACT_SENT', actor: 'SYSTEM', data: { provider: res.provider, delivery, external_id: res.externalId ?? null } });
      await refreshDerivedState(state, runtime);
      await runtime.persist(state);
      const where = delivery === 'email' ? `emailed to ${state.facts.email}` : 'texted to their phone';
      return {
        name,
        ok: true,
        output: {
          ok: true,
          sent: true,
          tell_caller: `The agreement was ${where}. It can take a minute to arrive.`,
          guidance: config.contracts.stay_on_line_to_sign
            ? 'Offer to stay on the line while they open it. Walk them through it: open the link, read through the agreement, fill in anything it asks for, sign, and tap the button at the end to finish. Answer questions from the agreement. When they say they are done, call check_agreement_status.'
            : 'Let them know they can review and sign whenever they are ready, and call with any questions.',
        },
      };
    }

    case 'check_agreement_status': {
      const c = state.contract;
      if (!c.sent) return reject(name, 'No agreement has been sent on this call.');
      if (!c.signed && runtime.contracts.getStatus) {
        const res = await runtime.contracts.getStatus(state);
        if (!res.ok) {
          return { name, ok: false, output: { ok: false, error: 'Could not check right now.', guidance: 'Wait a moment and check again, or let them know the team will confirm.' } };
        }
        if (await applyAgreementStatus(state, res.status, runtime.audit, runtime.now(), 'status_check')) {
          await refreshDerivedState(state, runtime);
          await runtime.persist(state);
        }
      }
      return { name, ok: true, output: { ok: true, opened: c.viewed, signed: c.signed, guidance: agreementStatusGuidance(state, Boolean(runtime.contracts.getStatus)) } };
    }

    case 'resend_engagement_agreement': {
      const c = state.contract;
      if (!c.sent || c.signed || c.closedReason) return reject(name, c.signed ? 'The agreement is already signed.' : 'There is no open agreement to resend.');
      if (!runtime.contracts.resend) return reject(name, 'Resending is not available. Let them know the team will follow up.');
      if (c.resends >= 3) return reject(name, 'Already resent several times. Request a callback so the team can help.');
      if (args.delivery === 'email') {
        const emailProblem = saveEmailFact(state, args.email);
        if (emailProblem) return { name, ok: false, output: { ok: false, error: emailProblem, ask: 'Ask for their email address and spell it back.' } };
      } else if (args.phone) {
        const r = applyFactUpdates(state.facts, { phone: args.phone });
        if (r.rejected.length) return { name, ok: false, output: { ok: false, error: r.rejected[0]!.problem, ask: 'Ask them to repeat the full 10-digit mobile number.' } };
        state.facts = r.facts;
      }
      const phone = state.facts.phone ?? state.callerIdNumber;
      if (args.delivery === 'sms' && (!phone || !config.contracts.delivery_methods.includes('sms'))) return reject(name, 'The agreement cannot be texted.');
      if (args.delivery === 'email' && !config.contracts.delivery_methods.includes('email')) return reject(name, 'The agreement cannot be emailed.');

      const res = await runtime.contracts.resend(state, { delivery: args.delivery, phone, email: state.facts.email ?? null });
      if (!res.ok) {
        await runtime.audit({ type: 'CONTRACT_SEND_FAILED', actor: 'SYSTEM', data: { resend: true, delivery: args.delivery, error: res.error } });
        return { name, ok: false, output: { ok: false, error: 'It could not be resent just now.', guidance: 'Apologize and request_callback so the team can get it to them.' } };
      }
      c.resends += 1;
      c.delivery = args.delivery;
      await runtime.audit({ type: 'CONTRACT_RESENT', actor: 'AI', data: { delivery: args.delivery } });
      await runtime.persist(state);
      return { name, ok: true, output: { ok: true, tell_caller: args.delivery === 'email' ? `Sent again to ${state.facts.email}.` : 'Texted again.' } };
    }

    case 'send_sms': {
      const to = state.facts.phone ?? state.callerIdNumber;
      if (!config.flags.sms_enabled || !to) {
        return reject(name, 'Text messages are not available. Do not offer a text.');
      }
      const b = businessStatusFor(runtime);
      const body =
        args.template === 'office_contact_info'
          ? `${config.firm_name}: thank you for calling. You can reach our office at this number during business hours.`
          : `${config.firm_name}: we received your message and someone from our team will call you back${b.status === 'business_hours' ? ' soon' : b.nextOpenPhrase ? ` ${b.nextOpenPhrase}` : ''}.`;
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
