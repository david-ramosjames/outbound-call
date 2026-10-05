import { z } from 'zod';
import { INBOUND_CASE_TYPES, QUALIFICATION_RESULTS } from './types.js';

// ---------- Feature flags ----------

export const inboundFlagsSchema = z.object({
  inbound_enabled: z.boolean().default(false),
  inbound_voice_enabled: z.boolean().default(false),
  qualification_enabled: z.boolean().default(true),
  human_transfer_enabled: z.boolean().default(false),
  contracts_enabled: z.boolean().default(false),
  sms_enabled: z.boolean().default(false),
  spanish_enabled: z.boolean().default(true),
  after_hours_ai_enabled: z.boolean().default(true),
  live_dashboard_enabled: z.boolean().default(true),
});
export type InboundFlags = z.infer<typeof inboundFlagsSchema>;

// ---------- Business hours ----------

const timeRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});
export type TimeRange = z.infer<typeof timeRangeSchema>;

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const weekday9to5 = [{ start: '08:00', end: '17:00' }];

export const businessHoursSchema = z.object({
  timezone: z.string().default('America/Chicago'),
  weekly: z
    .object({
      sun: z.array(timeRangeSchema).default([]),
      mon: z.array(timeRangeSchema).default(weekday9to5),
      tue: z.array(timeRangeSchema).default(weekday9to5),
      wed: z.array(timeRangeSchema).default(weekday9to5),
      thu: z.array(timeRangeSchema).default(weekday9to5),
      fri: z.array(timeRangeSchema).default(weekday9to5),
      sat: z.array(timeRangeSchema).default([]),
    })
    .default({}),
  holidays: z
    .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string() }))
    .default([]),
});
export type BusinessHoursConfig = z.infer<typeof businessHoursSchema>;

// ---------- Routing / transfer ----------

export const routingSchema = z.object({
  primary_transfer_number: z.string().default(''),
  backup_transfer_number: z.string().default(''),
  existing_client_transfer_number: z.string().default(''),
  business_hours_transfer_enabled: z.boolean().default(true),
  after_hours_transfer_enabled: z.boolean().default(false),
  transfer_timeout_seconds: z.number().int().min(5).max(120).default(25),
  /** What happens to an inbound call when inbound AI is switched off. */
  disabled_behavior: z.enum(['forward_to_primary', 'message']).default('forward_to_primary'),
  disabled_message: z
    .string()
    .default(
      'Thank you for calling {{firm_name}}. Please hold while we connect you, or call back during business hours.',
    ),
  record_calls: z.boolean().default(false),
  sms_from_number: z.string().default(''),
  max_call_seconds: z.number().int().min(60).max(7200).default(1800),
  voice: z.string().default('ara'),
});
export type RoutingConfig = z.infer<typeof routingSchema>;

// ---------- Contracts ----------

export const CONTRACT_PROVIDERS = ['none', 'signflow', 'sms_link', 'webhook'] as const;
export type ContractProviderName = (typeof CONTRACT_PROVIDERS)[number];

export const CONTRACT_DELIVERY_METHODS = ['sms', 'email'] as const;
export type ContractDeliveryMethod = (typeof CONTRACT_DELIVERY_METHODS)[number];

const templateIdSchema = z.number().int().positive().nullable().default(null);

export const contractsSchema = z.object({
  provider: z.enum(CONTRACT_PROVIDERS).default('none'),
  /** signflow provider: DocuSeal template per language (Spanish falls back to English when unset). */
  signflow_template_id_en: templateIdSchema,
  signflow_template_id_es: templateIdSchema,
  /** How the signing link may be delivered (signflow provider). The caller picks one. */
  delivery_methods: z.array(z.enum(CONTRACT_DELIVERY_METHODS)).default(['sms', 'email']),
  /** Keep the caller on the line after sending and help them sign. */
  stay_on_line_to_sign: z.boolean().default(true),
  /** What the agreement says, so the AI can answer questions. Spanish falls back to English when empty. */
  knowledge_en: z.string().max(60000).default(''),
  knowledge_es: z.string().max(60000).default(''),
  /** Firm-approved answers to common questions (fees, costs, cancelling...). Takes priority over the agreement text. */
  approved_answers: z.string().max(20000).default(''),
  allowed_results: z.array(z.enum(QUALIFICATION_RESULTS)).default(['qualified']),
  business_hours_allowed: z.boolean().default(true),
  after_hours_allowed: z.boolean().default(true),
  /** sms_link provider: link to the e-sign form. {{intake_id}} and {{caller_name}} are substituted. */
  sms_link_url: z.string().default(''),
  sms_message_template: z
    .string()
    .default(
      '{{firm_name}}: here is our engagement agreement to review and sign: {{link}} . Reply or call us with any questions.',
    ),
  /** webhook provider: POST intake JSON here; expect { external_id, signing_url }. */
  webhook_url: z.string().default(''),
});
export type ContractsConfig = z.infer<typeof contractsSchema>;

// ---------- Qualification rules ----------

export const RULE_OPERATORS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'is_true',
  'is_false',
  'is_set',
  'is_not_set',
  'gte',
  'lte',
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

/**
 * Fields a rule can test. Most map straight to intake facts; a few are derived
 * (incident_age_days, injury_severity_rank, any_urgent_indicator).
 */
export const RULE_FIELDS = [
  'case_type',
  'incident_state',
  'incident_age_days',
  'injury_severity',
  'injury_severity_rank',
  'injury_reported',
  'medical_treatment',
  'hospitalized',
  'surgery',
  'caller_at_fault',
  'commercial_vehicle_involved',
  'represented_by_attorney',
  'fatality',
  'minor_involved',
  'minor_seriously_injured',
  'multiple_injured',
  'statute_or_deadline_concern',
  'police_report',
  'any_urgent_indicator',
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const ruleConditionSchema = z.object({
  field: z.enum(RULE_FIELDS),
  op: z.enum(RULE_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
});
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export const qualificationRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  /** All conditions must match. */
  conditions: z.array(ruleConditionSchema).min(1),
  result: z.enum(QUALIFICATION_RESULTS),
  /** Internal reason recorded on the intake. Never read to the caller. */
  reason: z.string(),
  /** Whether a match on this rule permits offering the engagement agreement. */
  can_send_contract: z.boolean().default(false),
  /** A match blocks the agreement even if another rule allows it. */
  blocks_contract: z.boolean().default(false),
});
export type QualificationRule = z.infer<typeof qualificationRuleSchema>;

const PI_CASE_TYPES = INBOUND_CASE_TYPES.filter((t) => t !== 'unknown');

export const DEFAULT_QUALIFICATION_RULES: QualificationRule[] = [
  {
    id: 'fatality',
    name: 'Fatality / wrongful death',
    enabled: true,
    conditions: [{ field: 'fatality', op: 'is_true' }],
    result: 'high_priority',
    reason: 'Fatality reported (potential wrongful death)',
    can_send_contract: false,
    blocks_contract: true,
  },
  {
    id: 'wrongful_death_type',
    name: 'Wrongful death case type',
    enabled: true,
    conditions: [{ field: 'case_type', op: 'eq', value: 'wrongful_death' }],
    result: 'high_priority',
    reason: 'Wrongful death matter',
    can_send_contract: false,
    blocks_contract: true,
  },
  {
    id: 'commercial_vehicle',
    name: 'Commercial vehicle with injury',
    enabled: true,
    conditions: [
      { field: 'commercial_vehicle_involved', op: 'is_true' },
      { field: 'injury_reported', op: 'is_true' },
    ],
    result: 'high_priority',
    reason: 'Commercial vehicle collision with injury',
    can_send_contract: true,
    blocks_contract: false,
  },
  {
    id: 'hospitalized',
    name: 'Hospitalized',
    enabled: true,
    conditions: [{ field: 'hospitalized', op: 'is_true' }],
    result: 'high_priority',
    reason: 'Injured person was hospitalized',
    can_send_contract: true,
    blocks_contract: false,
  },
  {
    id: 'surgery',
    name: 'Surgery',
    enabled: true,
    conditions: [{ field: 'surgery', op: 'is_true' }],
    result: 'high_priority',
    reason: 'Surgery performed or recommended',
    can_send_contract: true,
    blocks_contract: false,
  },
  {
    id: 'catastrophic',
    name: 'Severe or catastrophic injury',
    enabled: true,
    conditions: [{ field: 'injury_severity_rank', op: 'gte', value: 3 }],
    result: 'high_priority',
    reason: 'Severe or catastrophic injury reported',
    can_send_contract: true,
    blocks_contract: false,
  },
  {
    id: 'minor_serious',
    name: 'Child seriously injured',
    enabled: true,
    conditions: [{ field: 'minor_seriously_injured', op: 'is_true' }],
    result: 'high_priority',
    reason: 'Minor seriously injured',
    can_send_contract: false,
    blocks_contract: true,
  },
  {
    id: 'multiple_injured',
    name: 'Multiple injured parties',
    enabled: true,
    conditions: [{ field: 'multiple_injured', op: 'is_true' }],
    result: 'high_priority',
    reason: 'Multiple injured parties',
    can_send_contract: true,
    blocks_contract: false,
  },
  {
    id: 'base_qualified',
    name: 'Injury + treatment + not represented + accepted type',
    enabled: true,
    conditions: [
      { field: 'case_type', op: 'in', value: [...PI_CASE_TYPES] },
      { field: 'injury_reported', op: 'is_true' },
      { field: 'medical_treatment', op: 'is_true' },
      { field: 'represented_by_attorney', op: 'is_false' },
      { field: 'incident_age_days', op: 'lte', value: 540 },
    ],
    result: 'qualified',
    reason: 'Accepted case type with reported injury, medical treatment, no current attorney, within accepted time period',
    can_send_contract: true,
    blocks_contract: false,
  },
  {
    id: 'represented',
    name: 'Already represented',
    enabled: true,
    conditions: [{ field: 'represented_by_attorney', op: 'is_true' }],
    result: 'needs_review',
    reason: 'Caller reports already having an attorney',
    can_send_contract: false,
    blocks_contract: true,
  },
  {
    id: 'outside_jurisdiction',
    name: 'Outside accepted jurisdiction',
    enabled: true,
    conditions: [
      { field: 'incident_state', op: 'is_set' },
      { field: 'incident_state', op: 'not_in', value: ['TX'] },
    ],
    result: 'not_qualified',
    reason: 'Incident occurred outside accepted jurisdiction',
    can_send_contract: false,
    blocks_contract: true,
  },
  {
    id: 'too_old',
    name: 'Incident older than 2 years',
    enabled: true,
    conditions: [{ field: 'incident_age_days', op: 'gte', value: 730 }],
    result: 'not_qualified',
    reason: 'Incident is older than the accepted time period (possible statute of limitations issue)',
    can_send_contract: false,
    blocks_contract: true,
  },
  {
    id: 'deadline_window',
    name: 'Approaching deadline (18-24 months)',
    enabled: true,
    conditions: [
      { field: 'incident_age_days', op: 'gte', value: 540 },
      { field: 'incident_age_days', op: 'lte', value: 729 },
    ],
    result: 'needs_review',
    reason: 'Incident is 18-24 months old: possible deadline issue, attorney review needed',
    can_send_contract: false,
    blocks_contract: true,
  },
  {
    id: 'deadline_concern',
    name: 'Caller mentions a deadline',
    enabled: true,
    conditions: [{ field: 'statute_or_deadline_concern', op: 'is_true' }],
    result: 'needs_review',
    reason: 'Caller raised a deadline or statute concern',
    can_send_contract: false,
    blocks_contract: true,
  },
  {
    id: 'no_injury',
    name: 'No injury reported',
    enabled: true,
    conditions: [{ field: 'injury_severity', op: 'eq', value: 'none' }],
    result: 'not_qualified',
    reason: 'No injury reported',
    can_send_contract: false,
    blocks_contract: true,
  },
  {
    id: 'no_treatment',
    name: 'No medical treatment',
    enabled: true,
    conditions: [
      { field: 'injury_reported', op: 'is_true' },
      { field: 'medical_treatment', op: 'is_false' },
    ],
    result: 'needs_review',
    reason: 'Injury reported but no medical treatment yet',
    can_send_contract: false,
    blocks_contract: true,
  },
  {
    id: 'caller_fault',
    name: 'Caller may be at fault',
    enabled: true,
    conditions: [{ field: 'caller_at_fault', op: 'in', value: ['yes', 'partial'] }],
    result: 'needs_review',
    reason: 'Caller may be fully or partially at fault',
    can_send_contract: false,
    blocks_contract: true,
  },
  {
    id: 'unknown_type',
    name: 'Unknown case type',
    enabled: true,
    conditions: [{ field: 'case_type', op: 'eq', value: 'unknown' }],
    result: 'needs_review',
    reason: 'Case type unclear',
    can_send_contract: false,
    blocks_contract: true,
  },
];

export const qualificationConfigSchema = z.object({
  rules: z.array(qualificationRuleSchema).default(DEFAULT_QUALIFICATION_RULES),
  /** Result when no rule matches. */
  default_result: z.enum(QUALIFICATION_RESULTS).default('needs_review'),
});
export type QualificationConfig = z.infer<typeof qualificationConfigSchema>;

// ---------- Whole inbound configuration ----------

export const inboundConfigSchema = z.object({
  /** The intake line's display name; fills {{firm_name}} in greetings and messages. */
  firm_name: z.string().default('our firm'),
  flags: inboundFlagsSchema.default({}),
  business_hours: businessHoursSchema.default({}),
  routing: routingSchema.default({}),
  contracts: contractsSchema.default({}),
  qualification: qualificationConfigSchema.default({}),
});
export type InboundConfig = z.infer<typeof inboundConfigSchema>;

/** Build a full config from a (possibly partial / older) stored line or settings row. */
export function resolveInboundConfig(row: unknown): InboundConfig {
  const source = (row ?? {}) as Record<string, unknown>;
  const name = typeof source.firm_name === 'string' ? source.firm_name : typeof source.name === 'string' ? source.name : undefined;
  const parsed = inboundConfigSchema.safeParse({
    firm_name: name?.trim() || undefined,
    flags: source.flags ?? undefined,
    business_hours: source.business_hours ?? undefined,
    routing: source.routing ?? undefined,
    contracts: source.contracts ?? undefined,
    qualification: source.qualification ?? undefined,
  });
  return parsed.success ? parsed.data : inboundConfigSchema.parse({});
}

// ---------- Agent instructions (editable copy) ----------

export const agentInstructionsSchema = z.object({
  agent_identity: z
    .string()
    .default(
      'You are the intake specialist for {{firm_name}}, a personal injury law firm. You are an AI assistant, not an attorney.',
    ),
  greeting_en: z
    .string()
    .default(
      "Thank you for calling {{firm_name}}. My name is Ana, I'm the firm's AI intake assistant. How can I help you today?",
    ),
  greeting_es: z
    .string()
    .default(
      'Gracias por llamar a {{firm_name}}. Me llamo Ana, soy la asistente de admisión virtual de la firma. ¿En qué le puedo ayudar hoy?',
    ),
  tone: z
    .string()
    .default(
      'Warm, calm, and unhurried. Acknowledge what the caller is going through before asking the next question. Short sentences. One question at a time.',
    ),
  english_instructions: z.string().default(''),
  spanish_instructions: z
    .string()
    .default(
      'Use natural, respectful Spanish ("usted"). Avoid literal translations of legal terms; explain plainly.',
    ),
  required_disclosures: z
    .string()
    .default(
      'Early in the call, let the caller know you are an AI assistant for the firm. If asked whether you are a person, say honestly that you are an AI assistant.',
    ),
  never_say: z
    .string()
    .default(
      [
        'That the firm will take or accept the case',
        'That the caller is now a client or that the firm represents them',
        'Any estimate of what the case is worth, or that they will receive compensation',
        'That an attorney has reviewed their case',
        'That an attorney is available unless the transfer tool confirms it',
        'Legal advice, including what to say to insurers or whether to give a recorded statement',
        'To stop, delay, or avoid medical treatment',
      ].join('\n'),
    ),
  escalation_instructions: z
    .string()
    .default(
      'If the caller is in crisis, mentions a death, a hospitalization, surgery, a commercial truck, or a seriously injured child, collect their name and best callback number first, then follow the tool guidance for transfer or urgent callback.',
    ),
  case_type_instructions: z.record(z.string()).default({}),
  transfer_language: z
    .string()
    .default("Based on what you've told me, I'd like to connect you with someone from our team. Please stay on the line."),
  transfer_failed_language: z
    .string()
    .default(
      "I'm sorry, I wasn't able to reach anyone on our team just now. I've marked your call as urgent so someone calls you back as soon as possible. Can I ask you a few more questions so they have everything they need?",
    ),
  contract_language: z
    .string()
    .default(
      "Based on the information you've provided, I can send you our engagement agreement to review and sign right now, by text or email. Would you like me to send it?",
    ),
  decline_language: z
    .string()
    .default(
      "Based on what you've shared, I'm not able to confirm that this is a matter our firm can assist with. I'll make sure the information you provided is saved for our team.",
    ),
  after_hours_language: z
    .string()
    .default(
      "Our office is closed right now, but I can take down your information so the team has everything they need, and someone will follow up {{next_open}}.",
    ),
  existing_client_language: z
    .string()
    .default("Thanks for calling. Let me get a few details so I can get your message to your case team."),
});
export type AgentInstructions = z.infer<typeof agentInstructionsSchema>;

/** Replace {{firm_name}} in a configurable message. */
export function withFirmName(text: string, firmName: string): string {
  return text.replace(/\{\{firm_name\}\}/g, firmName);
}

/** Resolve stored instructions; when firmName is given, {{firm_name}} is filled in everywhere. */
export function resolveAgentInstructions(content: unknown, firmName?: string): AgentInstructions {
  const parsed = agentInstructionsSchema.safeParse(content ?? {});
  const ins = parsed.success ? parsed.data : agentInstructionsSchema.parse({});
  if (!firmName) return ins;
  return {
    ...(Object.fromEntries(
      Object.entries(ins).map(([k, v]) => [k, typeof v === 'string' ? withFirmName(v, firmName) : v]),
    ) as AgentInstructions),
    case_type_instructions: Object.fromEntries(
      Object.entries(ins.case_type_instructions).map(([k, v]) => [k, withFirmName(v, firmName)]),
    ),
  };
}

// ---------- Intake lines (one per firm / brand) ----------

/** Normalize a US/E.164 phone number to +1XXXXXXXXXX (or +<digits>); null when it isn't one. */
export function normalizeE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export const inboundLineMetaSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, numbers and dashes'),
  phone_numbers: z.array(z.string()).max(20).default([]),
  signflow_firm_id: z.string().trim().max(100).default(''),
  is_default: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type InboundLineMeta = z.infer<typeof inboundLineMetaSchema>;

export interface InboundLineRow extends InboundLineMeta {
  id: string;
}

// ---------- Global integrations (non-secret; secrets stay in env) ----------

export const inboundIntegrationsSchema = z.object({
  /** Sign Flow deployment, e.g. https://sign-flow.vercel.app */
  signflow_base_url: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https?:\/\/\S+$/.test(v), 'must start with https://')
    .default(''),
});
export type InboundIntegrations = z.infer<typeof inboundIntegrationsSchema>;

export function resolveInboundIntegrations(raw: unknown): InboundIntegrations {
  const parsed = inboundIntegrationsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : inboundIntegrationsSchema.parse({});
}
