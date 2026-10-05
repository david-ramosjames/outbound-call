import type { IntakeFacts } from './facts.js';
import type { InboundIntakeState } from './state.js';
import { INBOUND_CASE_TYPE_LABELS, QUALIFICATION_RESULT_LABELS } from './types.js';

function yesNo(v: boolean | null | undefined): string | null {
  return v === true ? 'Yes' : v === false ? 'No' : null;
}

function lines(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(' ');
}

function headline(state: InboundIntakeState): string {
  const f = state.facts;
  if (f.caller_type === 'existing_client') return 'EXISTING CLIENT';
  if (f.caller_type === 'other') return 'OTHER CALL';
  const type = f.case_type ? INBOUND_CASE_TYPE_LABELS[f.case_type].toUpperCase() : 'UNKNOWN CASE TYPE';
  return `${state.highPriority || state.qualification?.result === 'high_priority' ? 'URGENT ' : ''}NEW LEAD - ${type}`;
}

function incident(f: IntakeFacts): string {
  const where = [f.incident_location, f.incident_city, f.incident_state].filter(Boolean).join(', ');
  return (
    lines(
      f.incident_description,
      where && `Location: ${where}.`,
      (f.incident_date || f.incident_date_text) && `Date: ${f.incident_date ?? f.incident_date_text}.`,
      f.commercial_vehicle_involved && `Commercial vehicle${f.trucking_company ? ` (${f.trucking_company})` : ''}.`,
      f.police_report !== undefined && f.police_report !== null && `Police report: ${yesNo(f.police_report)}${f.police_report_number ? ` #${f.police_report_number}` : ''}.`,
      f.fatality && 'FATALITY reported.',
      f.multiple_injured && 'Multiple people injured.',
    ) || 'Not collected.'
  );
}

function injuries(f: IntakeFacts): string {
  return (
    lines(
      f.injury_description,
      f.injury_severity && `Severity: ${f.injury_severity}.`,
      f.medical_treatment === true && `Treated${f.medical_treatment_description || f.hospital_or_provider ? `: ${[f.medical_treatment_description, f.hospital_or_provider].filter(Boolean).join(', ')}` : ''}.`,
      f.medical_treatment === false && 'No medical treatment yet.',
      f.hospitalized && 'Hospitalized.',
      f.surgery && 'Surgery.',
      f.minor_seriously_injured && 'Child seriously injured.',
    ) || 'Not collected.'
  );
}

/**
 * Plain-text summary for staff, readable in ~20 seconds.
 * Section order follows the firm's intake summary format.
 */
export function formatIntakeSummary(state: InboundIntakeState): string {
  const f = state.facts;
  const out: string[] = [headline(state), ''];

  out.push(`Caller: ${f.caller_name ?? 'Unknown'}`);
  out.push(`Phone: ${f.phone ?? state.callerIdNumber ?? 'Unknown'}`);
  if (f.email) out.push(`Email: ${f.email}`);
  out.push(`Language: ${state.language === 'es' ? 'Spanish' : 'English'}`);
  if (f.injured_person_name || f.caller_relationship_to_injured_person) {
    out.push(`Injured person: ${[f.injured_person_name, f.caller_relationship_to_injured_person && `(${f.caller_relationship_to_injured_person})`].filter(Boolean).join(' ')}`);
  }
  out.push('');

  if (f.caller_type === 'existing_client') {
    out.push('Case reference:', f.existing_client_case_reference ?? 'Not provided', '');
    out.push('Reason for call:', f.existing_client_reason ?? 'Not provided', '');
  } else if (f.caller_type === 'other') {
    out.push('Reason for call:', f.other_call_reason ?? 'Not provided', '');
  } else {
    out.push('Incident:', incident(f), '');
    out.push('Injuries:', injuries(f), '');
    const faultLine =
      f.caller_at_fault === 'no'
        ? 'Other party at fault (per caller).'
        : f.caller_at_fault === 'yes'
          ? 'Caller says they were at fault.'
          : f.caller_at_fault === 'partial'
            ? 'Caller may share fault.'
            : f.caller_at_fault === 'unknown'
              ? 'Fault unclear.'
              : 'Fault not determined.';
    out.push('Liability:', lines(faultLine, f.fault_summary) || 'Not collected.', '');
    out.push(
      'Representation:',
      f.represented_by_attorney === true
        ? `Currently represented${f.previous_attorney ? ` (${f.previous_attorney})` : ''}.`
        : f.represented_by_attorney === false
          ? 'Not currently represented.'
          : 'Unknown.',
      '',
    );
    out.push('Qualification:', state.qualification ? QUALIFICATION_RESULT_LABELS[state.qualification.result].toUpperCase() : 'NOT EVALUATED', '');
    const reasons = [...(state.qualification?.reasons ?? []), ...state.highPriorityReasons, ...state.needsReviewReasons];
    if (reasons.length) out.push('Reasons:', Array.from(new Set(reasons)).join('; ') + '.', '');
  }

  const actions: string[] = [];
  for (const t of state.transfers) {
    actions.push(`Transfer to ${t.label}: ${t.success === true ? 'connected' : t.success === false ? `failed (${t.failureReason ?? 'no answer'})` : 'attempted'}.`);
  }
  if (state.contract.sent) {
    const c = state.contract;
    const outcome = c.signed ? ' and SIGNED' : c.closedReason ? ` and ${c.closedReason.toUpperCase()}` : c.viewed ? ' and opened, not signed' : ', not opened yet';
    actions.push(`Engagement agreement sent by ${c.delivery === 'email' ? 'email' : 'text'}${outcome}.`);
  }
  else if (state.contract.lastError) actions.push('Engagement agreement FAILED to send.');
  for (const c of state.callbacks) {
    actions.push(`${c.priority === 'urgent' ? 'Urgent callback' : 'Callback'} requested${c.preferredTime ? ` (${c.preferredTime})` : ''}: ${c.reason}`);
  }
  if (f.declined_to_provide?.length) actions.push(`Declined to provide: ${f.declined_to_provide.join(', ')}.`);
  if (!state.completed) actions.push('Intake not completed (caller may have hung up).');
  out.push('Actions:', actions.length ? actions.join('\n') : 'None.');

  return out.join('\n').trim();
}
