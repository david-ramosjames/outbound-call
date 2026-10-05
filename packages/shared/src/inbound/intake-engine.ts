import { normalizeEmailCapture, normalizePhoneCapture } from '../utils/capture-validation.js';
import { intakeFactsSchema, type IntakeFacts } from './facts.js';
import type { InboundCaseType, InjurySeverity } from './types.js';

// ---------- Fact merging ----------

const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', tejas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};

export function normalizeStateCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return US_STATES[v.toLowerCase()] ?? v;
}

export interface FactUpdateResult {
  facts: IntakeFacts;
  changed: string[];
  rejected: Array<{ key: string; problem: string }>;
}

/**
 * Merge new facts into the intake. Each key is validated on its own so one bad
 * value (e.g. a malformed date) never discards the rest of the update.
 */
export function applyFactUpdates(current: IntakeFacts, updates: Record<string, unknown>): FactUpdateResult {
  const next: Record<string, unknown> = { ...current };
  const changed: string[] = [];
  const rejected: Array<{ key: string; problem: string }> = [];
  const shape = intakeFactsSchema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: Array<{ message: string }> } } }>;

  for (const [key, raw] of Object.entries(updates)) {
    if (raw === undefined) continue;
    const fieldSchema = shape[key];
    if (!fieldSchema) {
      rejected.push({ key, problem: 'Unknown fact. Use record_case_fact for case-specific details.' });
      continue;
    }

    let value: unknown = typeof raw === 'string' ? raw.trim() : raw;
    if (value === '') continue;

    if (key === 'phone' && typeof value === 'string') {
      const phone = normalizePhoneCapture(value);
      if (!phone.ok) {
        rejected.push({ key, problem: phone.problem });
        continue;
      }
      value = phone.value;
    }
    if (key === 'email' && typeof value === 'string') {
      const email = normalizeEmailCapture(value);
      if (!email.ok) {
        rejected.push({ key, problem: email.problem });
        continue;
      }
      value = email.value;
    }
    if (key === 'incident_state' && typeof value === 'string') {
      value = normalizeStateCode(value);
    }
    if (key === 'case_specific' && value && typeof value === 'object') {
      value = { ...(current.case_specific ?? {}), ...(value as Record<string, string>) };
    }
    if (key === 'declined_to_provide' && Array.isArray(value)) {
      value = Array.from(new Set([...(current.declined_to_provide ?? []), ...value.map(String)]));
    }

    const parsed = fieldSchema.safeParse(value);
    if (!parsed.success) {
      rejected.push({ key, problem: parsed.error?.issues[0]?.message ?? 'Invalid value' });
      continue;
    }
    if (JSON.stringify(next[key]) !== JSON.stringify(parsed.data)) {
      next[key] = parsed.data;
      changed.push(key);
    }
  }

  return { facts: next as IntakeFacts, changed, rejected };
}

// ---------- Derived facts ----------

const SEVERITY_RANK: Record<InjurySeverity, number> = {
  none: 0,
  minor: 1,
  moderate: 2,
  severe: 3,
  catastrophic: 4,
  unknown: -1,
};

export function injurySeverityRank(facts: IntakeFacts): number | null {
  if (!facts.injury_severity) return null;
  return SEVERITY_RANK[facts.injury_severity];
}

export function injuryReported(facts: IntakeFacts): boolean | null {
  if (facts.injury_severity === 'none') return false;
  if (facts.injury_severity && facts.injury_severity !== 'unknown') return true;
  if (facts.injury_description || facts.hospitalized || facts.surgery || facts.fatality) return true;
  return null;
}

export function incidentAgeDays(facts: IntakeFacts, now: Date): number | null {
  if (!facts.incident_date) return null;
  const ms = now.getTime() - Date.parse(`${facts.incident_date}T12:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

// ---------- Urgent / high-value detection ----------

export const URGENT_INDICATORS = [
  'fatality',
  'catastrophic_injury',
  'hospitalized',
  'surgery',
  'commercial_trucking',
  'child_seriously_injured',
  'multiple_injured',
  'very_recent_major_collision',
  'deadline_concern',
] as const;
export type UrgentIndicator = (typeof URGENT_INDICATORS)[number];

export const URGENT_INDICATOR_LABELS: Record<UrgentIndicator, string> = {
  fatality: 'Fatality / wrongful death',
  catastrophic_injury: 'Catastrophic or severe injury',
  hospitalized: 'Hospitalized',
  surgery: 'Surgery',
  commercial_trucking: 'Commercial trucking collision',
  child_seriously_injured: 'Child seriously injured',
  multiple_injured: 'Multiple injured parties',
  very_recent_major_collision: 'Very recent major collision',
  deadline_concern: 'Potential statute / deadline issue',
};

export function detectUrgentIndicators(facts: IntakeFacts, now: Date): UrgentIndicator[] {
  const out: UrgentIndicator[] = [];
  const rank = injurySeverityRank(facts) ?? -1;
  const age = incidentAgeDays(facts, now);

  if (facts.fatality || facts.case_type === 'wrongful_death') out.push('fatality');
  if (rank >= 3) out.push('catastrophic_injury');
  if (facts.hospitalized) out.push('hospitalized');
  if (facts.surgery) out.push('surgery');
  if (facts.case_type === 'trucking' || facts.commercial_vehicle_involved) {
    if (injuryReported(facts) !== false) out.push('commercial_trucking');
  }
  if (facts.minor_seriously_injured) out.push('child_seriously_injured');
  if (facts.multiple_injured) out.push('multiple_injured');
  if (age !== null && age <= 3 && (rank >= 2 || facts.hospitalized)) {
    out.push('very_recent_major_collision');
  }
  if (facts.statute_or_deadline_concern || (age !== null && age >= 540)) out.push('deadline_concern');
  return out;
}

// ---------- Missing information ----------

export interface MissingField {
  key: string;
  label: string;
  /** Why it matters, phrased for the agent. */
  hint: string;
}

const BASE_FIELDS: MissingField[] = [
  { key: 'caller_name', label: 'Caller name', hint: 'Full name (first and last). If they gave only a first name, ask for their last name' },
  { key: 'phone', label: 'Callback number', hint: 'Best number to reach them (confirm if it is the number they are calling from)' },
  { key: 'case_type', label: 'Type of incident', hint: 'What kind of incident this was' },
  { key: 'incident_date', label: 'When it happened', hint: 'Date of the incident (approximate is fine)' },
  { key: 'incident_location', label: 'Where it happened', hint: 'City and state, road or business name' },
  { key: 'incident_description', label: 'What happened', hint: 'Brief description in their words' },
  {
    key: 'injury_description',
    label: 'Injuries',
    hint: 'Where they are hurt or what hurts (e.g. neck and back pain). If they only say they were hurt, ask where it hurts',
  },
  { key: 'medical_treatment', label: 'Medical treatment', hint: 'Whether they have seen a doctor, ER, or other provider' },
  { key: 'fault_summary', label: 'How it happened (fault facts)', hint: 'Facts about how it happened, e.g. stopped at a light and was hit from behind' },
  {
    key: 'caller_at_fault',
    label: 'Who was at fault',
    hint: "Record from the caller's own account: no if they clearly describe the other party causing it (rear-ended while stopped, other driver ran a red light or turned into them); yes/partial if they say they caused it or share blame. If it is unclear, ask one neutral follow-up (e.g. \"What was the other driver doing?\" or \"Did anyone say whose fault it was?\") before recording unknown. Never tell the caller who is at fault",
  },
  { key: 'represented_by_attorney', label: 'Current attorney', hint: 'Whether they have already hired an attorney for this' },
];

const CASE_TYPE_FIELDS: Partial<Record<InboundCaseType, MissingField[]>> = {
  motor_vehicle: [
    { key: 'police_report', label: 'Police report', hint: 'Whether police came / a report was made' },
    { key: 'insurance_information', label: 'Insurance', hint: 'Their insurance and the other driver\'s insurance if known' },
    { key: 'property_damage', label: 'Vehicle damage', hint: 'Damage to their vehicle' },
  ],
  trucking: [
    { key: 'commercial_vehicle_involved', label: 'Commercial truck', hint: 'Confirm it was a commercial truck / 18-wheeler' },
    { key: 'trucking_company', label: 'Trucking company', hint: 'Company name or logo on the truck, if known' },
    { key: 'police_report', label: 'Police report', hint: 'Whether police came / a report was made' },
    { key: 'hospitalized', label: 'Hospitalized', hint: 'Whether anyone was taken to or admitted to a hospital' },
    { key: 'photos_or_video', label: 'Photos / video', hint: 'Whether there are photos or dashcam video' },
  ],
  pedestrian: [
    { key: 'police_report', label: 'Police report', hint: 'Whether police came / a report was made' },
    { key: 'other_party', label: 'Driver', hint: 'Whether the driver stayed and was identified' },
  ],
  bicycle: [
    { key: 'police_report', label: 'Police report', hint: 'Whether police came / a report was made' },
    { key: 'other_party', label: 'Driver', hint: 'Whether the driver stayed and was identified' },
  ],
  motorcycle: [
    { key: 'police_report', label: 'Police report', hint: 'Whether police came / a report was made' },
    { key: 'insurance_information', label: 'Insurance', hint: 'Insurance information if known' },
  ],
  premises_liability: [
    { key: 'case_specific.property_owner', label: 'Property / business', hint: 'Name of the business or property owner' },
    { key: 'case_specific.hazard', label: 'Hazard', hint: 'What caused the fall or injury (wet floor, broken step, etc.)' },
    { key: 'case_specific.reported_to_owner', label: 'Reported', hint: 'Whether they reported it to the business / an incident report was made' },
  ],
  wrongful_death: [
    { key: 'caller_relationship_to_injured_person', label: 'Relationship', hint: 'Their relationship to the person who passed away (ask gently)' },
    { key: 'injured_person_name', label: 'Name of the deceased', hint: 'Name of their loved one (ask gently)' },
  ],
  dog_bite: [
    { key: 'case_specific.dog_owner', label: 'Dog owner', hint: 'Whether the owner is known' },
    { key: 'case_specific.animal_control_report', label: 'Animal control', hint: 'Whether animal control or police were contacted' },
  ],
};

/** Minimum needed to protect an urgent lead before escalating. */
const URGENT_MINIMUM: MissingField[] = [
  BASE_FIELDS[0]!,
  BASE_FIELDS[1]!,
  { key: 'incident_description', label: 'What happened', hint: 'One-sentence description' },
];

function hasValue(facts: IntakeFacts, key: string): boolean {
  if (key === 'incident_location') {
    return Boolean(facts.incident_location || facts.incident_city || facts.incident_state);
  }
  if (key.startsWith('case_specific.')) {
    return Boolean(facts.case_specific?.[key.slice('case_specific.'.length)]);
  }
  if (key === 'caller_name') {
    return (facts.caller_name ?? '').trim().split(/\s+/).filter(Boolean).length >= 2;
  }
  if (key === 'injury_description') {
    return Boolean(facts.injury_description || (facts.injury_severity && facts.injury_severity !== 'unknown'));
  }
  const v = (facts as Record<string, unknown>)[key];
  return v !== undefined && v !== null && v !== '';
}

export interface MissingFieldsReport {
  mode: 'existing_client' | 'other' | 'urgent_minimum' | 'full_intake' | 'identify_caller';
  missing: MissingField[];
  declined: string[];
}

export function getMissingFields(facts: IntakeFacts, now: Date): MissingFieldsReport {
  const declined = facts.declined_to_provide ?? [];
  const filter = (list: MissingField[]) =>
    list.filter((f) => !hasValue(facts, f.key) && !declined.includes(f.key));

  if (!facts.caller_type) {
    return {
      mode: 'identify_caller',
      missing: [{ key: 'caller_type', label: 'Reason for call', hint: 'Whether this is a new injury matter, an existing client, or something else' }],
      declined,
    };
  }
  if (facts.caller_type === 'existing_client') {
    return {
      mode: 'existing_client',
      missing: filter([
        BASE_FIELDS[0]!,
        BASE_FIELDS[1]!,
        { key: 'existing_client_case_reference', label: 'Case reference', hint: 'Case number or name on the case, if they know it' },
        { key: 'existing_client_reason', label: 'Reason for call', hint: 'What they need help with today' },
      ]),
      declined,
    };
  }
  if (facts.caller_type === 'other') {
    return {
      mode: 'other',
      missing: filter([
        BASE_FIELDS[0]!,
        BASE_FIELDS[1]!,
        { key: 'other_call_reason', label: 'Reason for call', hint: 'Why they are calling' },
      ]),
      declined,
    };
  }

  const urgentMissing = filter(URGENT_MINIMUM);
  if (detectUrgentIndicators(facts, now).length > 0 && urgentMissing.length > 0) {
    return { mode: 'urgent_minimum', missing: urgentMissing, declined };
  }

  const caseFields = (facts.case_type && CASE_TYPE_FIELDS[facts.case_type]) || [];
  return { mode: 'full_intake', missing: filter([...BASE_FIELDS, ...caseFields]), declined };
}

// ---------- Stage (for the live view) ----------

export const INTAKE_STAGES = [
  'greeting',
  'reason_for_call',
  'contact_information',
  'incident_details',
  'injury_and_treatment',
  'liability',
  'representation',
  'qualification',
  'next_action',
] as const;
export type IntakeStage = (typeof INTAKE_STAGES)[number];

export function currentIntakeStage(facts: IntakeFacts, now: Date): IntakeStage {
  const report = getMissingFields(facts, now);
  if (report.mode === 'identify_caller') return facts.caller_name ? 'reason_for_call' : 'greeting';
  const keys = new Set(report.missing.map((m) => m.key));
  if (keys.has('caller_name') || keys.has('phone')) return 'contact_information';
  if (report.mode !== 'full_intake') return 'next_action';
  if (['case_type', 'incident_date', 'incident_location', 'incident_description'].some((k) => keys.has(k))) {
    return 'incident_details';
  }
  if (keys.has('injury_description') || keys.has('medical_treatment')) return 'injury_and_treatment';
  if (keys.has('fault_summary') || keys.has('caller_at_fault')) return 'liability';
  if (keys.has('represented_by_attorney')) return 'representation';
  if (report.missing.length > 0) return 'incident_details';
  return 'qualification';
}

export function caseTypeQuestionHints(caseType: InboundCaseType | null | undefined): MissingField[] {
  return (caseType && CASE_TYPE_FIELDS[caseType]) || [];
}
