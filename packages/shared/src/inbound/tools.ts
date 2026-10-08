import { z } from 'zod';
import { CONTRACT_DELIVERY_METHODS } from './config.js';
import { INBOUND_CALLER_TYPES, INBOUND_CASE_TYPES, INBOUND_LANGUAGES, INJURY_SEVERITIES } from './types.js';
import { LEAD_SOURCES } from './facts.js';

// ---------- Argument schemas (validated server-side before anything runs) ----------

const factsInput = z.record(z.unknown());

export const inboundToolArgSchemas = {
  save_contact_information: z.object({
    caller_name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    use_caller_id_number: z.boolean().optional(),
    preferred_language: z.enum(INBOUND_LANGUAGES).optional(),
  }),
  update_intake: z.object({ facts: factsInput }),
  record_case_fact: z.object({ key: z.string().min(1).max(64), value: z.string().min(1).max(1000) }),
  get_missing_intake_fields: z.object({}).passthrough(),
  evaluate_qualification: z.object({}).passthrough(),
  get_business_status: z.object({}).passthrough(),
  get_available_actions: z.object({}).passthrough(),
  transfer_to_human: z.object({ reason: z.string().min(1).max(500) }),
  request_callback: z.object({
    reason: z.string().min(1).max(1000),
    preferred_time: z.string().max(200).optional(),
    phone: z.string().optional(),
    urgent: z.boolean().optional(),
  }),
  send_engagement_agreement: z.object({
    caller_consented: z.literal(true),
    delivery: z.enum(CONTRACT_DELIVERY_METHODS).optional(),
    email: z.string().max(200).optional(),
  }),
  check_agreement_status: z.object({}).passthrough(),
  resend_engagement_agreement: z.object({
    delivery: z.enum(CONTRACT_DELIVERY_METHODS),
    email: z.string().max(200).optional(),
    phone: z.string().max(40).optional(),
  }),
  send_sms: z.object({ template: z.enum(['office_contact_info', 'callback_confirmation']) }),
  mark_high_priority: z.object({ reason: z.string().min(1).max(500) }),
  mark_needs_review: z.object({ reason: z.string().min(1).max(500) }),
  set_language: z.object({ language: z.enum(INBOUND_LANGUAGES) }),
  record_declined_field: z.object({ key: z.string().min(1).max(64) }),
  complete_intake: z.object({ summary_for_staff: z.string().max(2000).optional() }),
  end_call: z.object({ reason: z.string().max(500).optional() }),
} as const;

export type InboundToolName = keyof typeof inboundToolArgSchemas;
export const INBOUND_TOOL_NAMES = Object.keys(inboundToolArgSchemas) as InboundToolName[];

export function isInboundToolName(name: string): name is InboundToolName {
  return Object.prototype.hasOwnProperty.call(inboundToolArgSchemas, name);
}

// ---------- JSON schema for the model ----------

const str = (description: string) => ({ type: 'string', description });
const bool = (description: string) => ({ type: 'boolean', description });
const enumOf = (values: readonly string[], description: string) => ({ type: 'string', enum: [...values], description });

const FACT_PROPERTIES: Record<string, Record<string, unknown>> = {
  caller_type: enumOf(INBOUND_CALLER_TYPES, 'new_potential_client for a new injury matter, existing_client, or other (vendor, medical provider, insurance company, wrong number, etc.)'),
  caller_name: str('Caller full name (first and last)'),
  caller_relationship_to_injured_person: str('If calling for someone else: relationship (self, spouse, parent, child, friend...)'),
  injured_person_name: str('Name of the injured person if not the caller'),
  case_type: enumOf(INBOUND_CASE_TYPES, 'Type of incident'),
  incident_date: str('Incident date as YYYY-MM-DD. Convert relative dates ("last Tuesday") using today\'s date. Omit if unknown.'),
  incident_date_text: str('Incident date exactly as the caller described it'),
  incident_city: str('City'),
  incident_state: str('US state (two-letter code preferred)'),
  incident_location: str('Road, intersection, or business where it happened'),
  incident_description: str('Short description of what happened, in plain words'),
  injury_description: str('Injuries described by the caller'),
  injury_severity: enumOf(INJURY_SEVERITIES, 'Your best classification of injury severity from the caller\'s description. none only if they say nobody was hurt.'),
  medical_treatment: bool('Has the injured person received any medical treatment (ER, urgent care, doctor, chiropractor, PT)?'),
  medical_treatment_description: str('Where/what treatment'),
  hospitalized: bool('Admitted to or taken to a hospital by ambulance'),
  surgery: bool('Surgery performed or recommended'),
  hospital_or_provider: str('Hospital or provider name'),
  police_report: bool('Police came / report made'),
  police_report_number: str('Report number if they have it'),
  other_party: str('Other driver / party, as described'),
  commercial_vehicle_involved: bool('A commercial truck, 18-wheeler, company vehicle, bus, or delivery vehicle was involved'),
  trucking_company: str('Trucking/company name if known'),
  insurance_information: str('Insurance details mentioned'),
  represented_by_attorney: bool('Already has an attorney for this matter'),
  previous_attorney: str('Name of current/previous attorney'),
  fault_summary: str('Facts about how the incident happened (no judgments)'),
  caller_at_fault: enumOf(
    ['no', 'yes', 'partial', 'unknown'],
    "From the caller's own account only. no = they describe the other party causing it (e.g. rear-ended while stopped). If unclear, ask a follow-up first; unknown only if still unclear.",
  ),
  property_damage: str('Property / vehicle damage'),
  work_missed: str('Time missed from work'),
  witnesses: str('Witnesses'),
  photos_or_video: bool('Photos or video exist'),
  statute_or_deadline_concern: bool('Caller mentions a deadline, a letter about a deadline, or the incident being close to two years ago'),
  minor_involved: bool('A child under 18 was involved'),
  minor_seriously_injured: bool('A child was seriously injured'),
  fatality: bool('Someone died'),
  multiple_injured: bool('More than one person was injured'),
  existing_client_case_reference: str('Existing client\'s case number or name on the case'),
  existing_client_reason: str('Why the existing client is calling'),
  other_call_reason: str('Why a non-client is calling'),
  lead_source: enumOf(
    [...LEAD_SOURCES],
    'How they found the firm. "I googled injury lawyer" = google_search; "saw you at the top of Google" = google_ads; friend/family = personal_referral; another lawyer = attorney_referral; doctor/chiropractor = medical_provider_referral; filled a form on the website = website_form; Facebook/Instagram/TikTok = social_media; past client = returning_client.',
  ),
  lead_source_detail: str('Who referred them (name), which law firm, which ad or platform, etc.'),
};

type ToolDef = { type: 'function'; name: string; description: string; parameters: Record<string, unknown> };

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** Tool definitions in xAI realtime format. */
export function getInboundToolDefinitions(): ToolDef[] {
  return [
    {
      type: 'function',
      name: 'save_contact_information',
      description: 'Save the caller\'s name, callback number, email, or preferred language as soon as you learn them. Set use_caller_id_number true if they confirm the number they are calling from is best.',
      parameters: obj({
        caller_name: str('Full name, first and last. If you only have a first name, save it and ask for the last name.'),
        phone: str('Callback number, digits as spoken'),
        email: str('Email as spoken'),
        use_caller_id_number: bool('Caller confirmed the number they are calling from is the best callback number'),
        preferred_language: enumOf(INBOUND_LANGUAGES, 'Language they prefer'),
      }),
    },
    {
      type: 'function',
      name: 'update_intake',
      description: 'Record facts the caller has told you. Call this whenever you learn something new, including several facts at once. Only include facts the caller actually stated; never guess. Returns what is still missing.',
      parameters: obj({ facts: obj(FACT_PROPERTIES) }, ['facts']),
    },
    {
      type: 'function',
      name: 'record_case_fact',
      description: 'Record a case-specific detail that has no field in update_intake (e.g. property_owner, hazard, dog_owner, rideshare_company).',
      parameters: obj({ key: str('snake_case name'), value: str('What the caller said') }, ['key', 'value']),
    },
    {
      type: 'function',
      name: 'record_declined_field',
      description: 'The caller does not know or does not want to share this item. It will not be asked again.',
      parameters: obj({ key: str('Field name, e.g. email, incident_date, police_report') }, ['key']),
    },
    {
      type: 'function',
      name: 'get_missing_intake_fields',
      description: 'List the items still needed for this intake, in priority order.',
      parameters: obj({}),
    },
    {
      type: 'function',
      name: 'evaluate_qualification',
      description: 'Ask the firm\'s system to evaluate the intake. Returns only the recommended next step; the internal decision is never for the caller.',
      parameters: obj({}),
    },
    {
      type: 'function',
      name: 'get_business_status',
      description: 'Check whether the office is open and when it next opens.',
      parameters: obj({}),
    },
    {
      type: 'function',
      name: 'get_available_actions',
      description: 'Check which actions (transfer, engagement agreement, callback) are allowed right now, and the recommended next step.',
      parameters: obj({}),
    },
    {
      type: 'function',
      name: 'transfer_to_human',
      description: 'Transfer the caller to a team member. Only use after get_available_actions says a transfer is allowed and the caller agrees. Say the transfer language first.',
      parameters: obj({ reason: str('Short reason for staff') }, ['reason']),
    },
    {
      type: 'function',
      name: 'request_callback',
      description: 'Create a callback request / message for the team.',
      parameters: obj(
        {
          reason: str('What the callback is about'),
          preferred_time: str('When they prefer to be called, if stated'),
          phone: str('Number to call back if different from the one saved'),
          urgent: bool('Urgent'),
        },
        ['reason'],
      ),
    },
    {
      type: 'function',
      name: 'send_engagement_agreement',
      description:
        'Send the engagement agreement for e-signature. Only after a tool says can_offer_agreement is true AND the caller clearly said yes. Ask whether they prefer text or email (only offer the methods listed in agreement_delivery).',
      parameters: obj(
        {
          caller_consented: { type: 'boolean', enum: [true], description: 'Caller explicitly agreed' },
          delivery: enumOf(CONTRACT_DELIVERY_METHODS, 'sms = text to their phone, email = send to their email'),
          email: str('Email address as spoken and confirmed, if sending by email and not already saved'),
        },
        ['caller_consented'],
      ),
    },
    {
      type: 'function',
      name: 'check_agreement_status',
      description:
        'Check whether the caller has opened and signed the agreement. Call when they say they finished signing, or after they have had a minute or two. Never tell them it is signed unless this says signed: true.',
      parameters: obj({}),
    },
    {
      type: 'function',
      name: 'resend_engagement_agreement',
      description: 'Re-send the agreement link if they did not get it, or by the other method (text vs email), or to a corrected email/number.',
      parameters: obj(
        {
          delivery: enumOf(CONTRACT_DELIVERY_METHODS, 'sms or email'),
          email: str('Corrected email address, if any'),
          phone: str('Corrected mobile number, if any'),
        },
        ['delivery'],
      ),
    },
    {
      type: 'function',
      name: 'send_sms',
      description: 'Text the caller an approved message. Free-form text is not allowed.',
      parameters: obj({ template: enumOf(['office_contact_info', 'callback_confirmation'], 'Which approved message') }, ['template']),
    },
    {
      type: 'function',
      name: 'mark_high_priority',
      description: 'Flag the intake as urgent for staff (e.g. death, hospitalization, serious child injury, commercial truck).',
      parameters: obj({ reason: str('Why') }, ['reason']),
    },
    {
      type: 'function',
      name: 'mark_needs_review',
      description: 'Flag the intake for human review (unclear facts, caller confusion, anything you are unsure about).',
      parameters: obj({ reason: str('Why') }, ['reason']),
    },
    {
      type: 'function',
      name: 'set_language',
      description: 'Call when the caller switches language or asks for English or Spanish. Then continue in that language.',
      parameters: obj({ language: enumOf(INBOUND_LANGUAGES, 'en or es') }, ['language']),
    },
    {
      type: 'function',
      name: 'complete_intake',
      description: 'Mark the intake finished before saying goodbye.',
      parameters: obj({ summary_for_staff: str('One or two sentences for the team') }),
    },
    {
      type: 'function',
      name: 'end_call',
      description: 'Hang up after the closing. Call complete_intake first.',
      parameters: obj({ reason: str('Why the call is ending') }),
    },
  ];
}

/** Same tools in chat-completions format (used by the text Test Agent). */
export function getInboundChatToolDefinitions() {
  return getInboundToolDefinitions().map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
