import type { BusinessStatus } from './business-hours.js';
import type { ContractDeliveryMethod, InboundConfig } from './config.js';
import { detectUrgentIndicators, getMissingFields } from './intake-engine.js';
import type { InboundIntakeState } from './state.js';
import type { InboundLanguage, NextAction } from './types.js';

/** DocuSeal template for the caller's language; Spanish falls back to English. */
export function contractTemplateIdFor(config: InboundConfig, language: InboundLanguage): number | null {
  const c = config.contracts;
  return (language === 'es' ? c.signflow_template_id_es : null) ?? c.signflow_template_id_en;
}

/** Ways the agreement can reach this caller right now. Email can be collected on the call. */
export function contractDeliveryOptions(state: InboundIntakeState, config: InboundConfig): ContractDeliveryMethod[] {
  const hasPhone = Boolean(state.facts.phone || state.callerIdNumber);
  const c = config.contracts;
  if (c.provider === 'signflow') return c.delivery_methods.filter((m) => m === 'email' || hasPhone);
  if (c.provider === 'sms_link' && !config.flags.sms_enabled) return [];
  return hasPhone ? ['sms'] : [];
}

export interface TransferTarget {
  label: 'primary' | 'backup' | 'existing_client';
  number: string;
}

export interface AvailableActions {
  businessStatus: BusinessStatus['status'];
  canTransfer: boolean;
  transferBlockedReason: string | null;
  nextTransferTarget: TransferTarget | null;
  canOfferContract: boolean;
  contractBlockedReason: string | null;
  contractDelivery: ContractDeliveryMethod[];
  canSendSms: boolean;
  shouldRequestCallback: boolean;
  callbackPriority: 'urgent' | 'normal';
  urgent: boolean;
  recommendedNextAction: NextAction;
  /** Plain-language guidance for the agent. Never contains rules or scores. */
  guidance: string;
}

function transferTargets(config: InboundConfig, existingClient: boolean): TransferTarget[] {
  const r = config.routing;
  const list: TransferTarget[] = [];
  if (existingClient && r.existing_client_transfer_number.trim()) {
    list.push({ label: 'existing_client', number: r.existing_client_transfer_number.trim() });
  }
  if (r.primary_transfer_number.trim()) list.push({ label: 'primary', number: r.primary_transfer_number.trim() });
  if (r.backup_transfer_number.trim()) list.push({ label: 'backup', number: r.backup_transfer_number.trim() });
  return list;
}

/**
 * Decide what the agent is allowed to do right now. Depends on the firm's
 * operating status, feature flags, qualification, and what has already been tried.
 */
export function computeAvailableActions(
  state: InboundIntakeState,
  config: InboundConfig,
  business: BusinessStatus,
  now: Date,
): AvailableActions {
  const { flags, routing, contracts } = config;
  const facts = state.facts;
  const existingClient = facts.caller_type === 'existing_client';
  const qual = state.qualification?.result ?? null;
  const urgent = state.highPriority || detectUrgentIndicators(facts, now).length > 0 || qual === 'high_priority';
  const open = business.status === 'business_hours';

  // ----- Transfer -----
  const tried = new Set(state.transfers.map((t) => t.destination));
  const remaining = transferTargets(config, existingClient).filter((t) => !tried.has(t.number));
  let transferBlockedReason: string | null = null;
  if (!flags.human_transfer_enabled) transferBlockedReason = 'Human transfer is turned off';
  else if (remaining.length === 0)
    transferBlockedReason = state.transfers.length > 0 ? 'All transfer numbers already tried' : 'No transfer number configured';
  else if (open && !routing.business_hours_transfer_enabled) transferBlockedReason = 'Transfers disabled during business hours';
  else if (!open && !routing.after_hours_transfer_enabled) transferBlockedReason = 'Team is not available (after hours)';
  else if (state.transferInProgress) transferBlockedReason = 'Transfer already in progress';
  else if (!existingClient && !(qual === 'qualified' || qual === 'high_priority' || urgent))
    transferBlockedReason = 'Lead has not qualified for a live transfer';
  else if (!facts.caller_name || !(facts.phone || state.callerIdNumber))
    transferBlockedReason = 'Collect name and callback number before transferring';
  const canTransfer = transferBlockedReason === null;

  // ----- Contract -----
  const contractDelivery = contractDeliveryOptions(state, config);
  let contractBlockedReason: string | null = null;
  if (!flags.contracts_enabled) contractBlockedReason = 'Engagement agreements are turned off';
  else if (contracts.provider === 'none') contractBlockedReason = 'No agreement provider configured';
  else if (!flags.sms_enabled && contracts.provider === 'sms_link') contractBlockedReason = 'SMS is turned off';
  else if (contracts.provider === 'signflow' && !contractTemplateIdFor(config, state.language))
    contractBlockedReason = 'No agreement template configured';
  else if (state.contract.sent) contractBlockedReason = 'Agreement already sent';
  else if (!state.qualification) contractBlockedReason = 'Qualification has not been run';
  else if (!state.qualification.canSendContract) contractBlockedReason = 'Qualification does not permit an agreement';
  else if (!contracts.allowed_results.includes(state.qualification.result))
    contractBlockedReason = 'Qualification result is not eligible for an agreement';
  else if (open && !contracts.business_hours_allowed) contractBlockedReason = 'Agreements not offered during business hours';
  else if (!open && !contracts.after_hours_allowed) contractBlockedReason = 'Agreements not offered after hours';
  else if (contractDelivery.length === 0) contractBlockedReason = 'No way to deliver the agreement';
  else if (getMissingFields(facts, now).missing.length > 0) contractBlockedReason = 'Finish the intake questions first';
  const canOfferContract = contractBlockedReason === null;

  const canSendSms = flags.sms_enabled && Boolean(facts.phone || state.callerIdNumber);

  // ----- Recommendation -----
  const missing = getMissingFields(facts, now);
  const transferFailed = state.transfers.some((t) => t.success === false);
  const awaitingSignature =
    contracts.stay_on_line_to_sign && state.contract.sent && !state.contract.signed && !state.contract.closedReason;
  let recommended: NextAction;

  if (missing.mode === 'identify_caller') recommended = 'identify_caller';
  else if (existingClient) recommended = missing.missing.length > 0 ? 'continue_intake' : canTransfer ? 'offer_transfer' : 'take_message';
  else if (facts.caller_type === 'other') recommended = missing.missing.length > 0 ? 'continue_intake' : 'take_message';
  else if (missing.mode === 'urgent_minimum') recommended = 'collect_minimum_contact';
  else if (urgent && canTransfer) recommended = 'offer_transfer';
  else if (missing.missing.length > 0) recommended = 'continue_intake';
  else if (!state.qualification) recommended = 'complete_intake';
  else if (qual === 'not_qualified') recommended = 'decline_politely';
  else if (awaitingSignature) recommended = 'help_sign_agreement';
  else if (qual === 'qualified' && canTransfer) recommended = 'offer_transfer';
  else if (canOfferContract && !state.contract.offered) recommended = 'offer_contract';
  else if ((qual === 'qualified' || urgent) && state.callbacks.length === 0) recommended = 'request_callback';
  else recommended = 'complete_intake';

  const shouldRequestCallback =
    state.callbacks.length === 0 &&
    (transferFailed || urgent || existingClient || qual === 'qualified' || qual === 'needs_review');
  const callbackPriority: 'urgent' | 'normal' = urgent || transferFailed ? 'urgent' : 'normal';

  return {
    businessStatus: business.status,
    canTransfer,
    transferBlockedReason,
    nextTransferTarget: canTransfer ? remaining[0] ?? null : null,
    canOfferContract,
    contractBlockedReason,
    contractDelivery,
    canSendSms,
    shouldRequestCallback,
    callbackPriority,
    urgent,
    recommendedNextAction: recommended,
    guidance: guidanceFor(recommended, business, urgent, transferFailed),
  };
}

function guidanceFor(action: NextAction, business: BusinessStatus, urgent: boolean, transferFailed: boolean): string {
  const followUp = business.nextOpenPhrase ? `as soon as the office opens (${business.nextOpenPhrase})` : 'as soon as possible';
  switch (action) {
    case 'identify_caller':
      return 'Find out why they are calling: a new injury matter, an existing client, or something else.';
    case 'collect_minimum_contact':
      return 'This sounds serious. Get their name, best callback number, and one sentence about what happened, then check actions again. Do not run through the full questionnaire first.';
    case 'continue_intake':
      return 'Keep the conversation going naturally. Ask about the next missing item in your own words, one question at a time. Skip anything they already told you.';
    case 'offer_transfer':
      return 'Offer to connect them with someone from the team now using the transfer language. If they agree, call transfer_to_human.';
    case 'offer_contract':
      return 'You may offer the engagement agreement using the contract language. Only call send_engagement_agreement after they clearly say yes.';
    case 'help_sign_agreement':
      return 'The agreement has been sent. Stay on the line and help them open, review, and sign it. Answer questions from the agreement. When they say they finished, call check_agreement_status; only confirm it is signed if the tool says so. If they would rather sign later, that is fine: request_callback, then complete_intake.';
    case 'request_callback':
      return transferFailed || urgent
        ? `Call request_callback with urgent priority and tell them someone will reach out ${business.status === 'business_hours' ? 'shortly' : followUp}.`
        : `Call request_callback and tell them someone will follow up ${business.status === 'business_hours' ? 'soon' : followUp}.`;
    case 'take_message':
      return `Take a clear message (call request_callback) and let them know their case team will follow up ${business.status === 'business_hours' ? 'soon' : followUp}.`;
    case 'decline_politely':
      return 'Use the decline language gently. Do not argue or explain internal criteria. Make sure their information is saved, then call complete_intake.';
    case 'complete_intake':
      return 'Call evaluate_qualification if you have not, request a callback if appropriate, then call complete_intake and close warmly.';
  }
}
