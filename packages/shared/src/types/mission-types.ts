export const MISSION_TYPES = [
  'open_claim_third_party',
  'open_claim_first_party',
  'follow_up_existing_claim',
  'request_adjuster_contact',
  'request_claim_documents',
  'pip_follow_up',
  /** Legacy: missions created before the first/third-party split. Not offered in the wizard. */
  'open_insurance_claim',
] as const;

export type MissionType = (typeof MISSION_TYPES)[number];

export const SELECTABLE_MISSION_TYPES: readonly MissionType[] = MISSION_TYPES.filter(
  (t) => t !== 'open_insurance_claim',
);

export const MISSION_TYPE_LABELS: Record<MissionType, string> = {
  open_claim_third_party: 'Open claim — Third party (other driver’s carrier)',
  open_claim_first_party: 'Open claim — First party / UM-UIM (client’s own carrier)',
  follow_up_existing_claim: 'Follow up on existing claim',
  request_adjuster_contact: 'Get adjuster / transfer',
  request_claim_documents: 'Request claim documents',
  pip_follow_up: 'PIP / medical benefits follow-up',
  open_insurance_claim: 'Open a new claim (legacy)',
};

export type ClaimParty = 'first_party' | 'third_party';

export function claimPartyForMissionType(missionType: MissionType): ClaimParty | null {
  if (missionType === 'open_claim_first_party') return 'first_party';
  if (missionType === 'open_claim_third_party') return 'third_party';
  return null;
}

/**
 * Values the agent should try to leave every claim call with. These feed the
 * Letter of Representation, so getting them on the first call avoids a second call.
 */
export const REQUIRED_CLAIM_OUTPUT_FIELDS = [
  'claim_number',
  'adjuster_name',
  'adjuster_phone',
  'adjuster_fax',
  'adjuster_email',
  'adjuster_mailing_address',
] as const;

export type RequiredClaimOutputField = (typeof REQUIRED_CLAIM_OUTPUT_FIELDS)[number];

export const REQUIRED_CLAIM_OUTPUT_LABELS: Record<RequiredClaimOutputField, string> = {
  claim_number: 'Claim number',
  adjuster_name: 'Adjuster full name',
  adjuster_phone: 'Adjuster phone',
  adjuster_fax: 'Adjuster fax',
  adjuster_email: 'Adjuster email',
  adjuster_mailing_address: 'Adjuster mailing address',
};

/** Why a call ended the way it did. Tracked per call so carrier / call-type patterns surface over time. */
export const OUTCOME_REASONS = [
  'completed',
  'ai_declined_restricted_request',
  'carrier_refused_ai',
  'unable_to_reach_representative',
  'missing_required_information',
  'human_follow_up_required',
] as const;

export type OutcomeReason = (typeof OUTCOME_REASONS)[number];

export const OUTCOME_REASON_LABELS: Record<OutcomeReason, string> = {
  completed: 'Completed',
  ai_declined_restricted_request: 'AI refused (restricted request)',
  carrier_refused_ai: "Carrier won't speak with AI",
  unable_to_reach_representative: 'Unable to reach representative',
  missing_required_information: 'Missing required information',
  human_follow_up_required: 'Human follow-up required',
};

export function isOutcomeReason(value: unknown): value is OutcomeReason {
  return typeof value === 'string' && (OUTCOME_REASONS as readonly string[]).includes(value);
}

export const APPROVED_CONTEXT_FIELDS = [
  // Caller / firm identity
  'caller_name',
  'attorney_name',
  'law_firm_name',
  'law_firm_phone_number',
  'law_firm_email_address',
  'law_firm_fax_number',
  'law_firm_mailing_address',
  'representation_status',

  // Client identity (IVR verification)
  'client_full_name',
  'client_name_phonetic',
  'client_date_of_birth',
  'client_phone_number',
  'client_zip_code',
  'client_city',
  'client_address',
  'accident_state',

  // Policy / claim
  'insurance_carrier',
  'policy_number',
  'policy_type',
  'policyholder_status',
  'insured_name',
  'client_role_in_loss',
  'insured_vehicle_description',
  'existing_claim_number',
  'claim_number_spoken',
  'date_of_loss',
  'time_of_loss',
  'location_of_loss',
  'incident_type',
  'case_type',
  'brief_incident_description',

  // Vehicle
  'vehicle_year',
  'vehicle_make',
  'vehicle_model',
  'vehicle_identification_number',
  'vehicle_location_city',

  // Known contacts / routing
  'target_department',
  'known_adjuster_name',
  'known_adjuster_phone',
  'known_adjuster_extension',
  'known_adjuster_email',

  // Prior correspondence
  'lor_sent_date',
  'demand_sent_date',
  'documents_previously_sent',
  'preferred_document_delivery',

  // Other notes
  'police_report_number',
  'other_approved_notes',
] as const;

export type ApprovedContextField = (typeof APPROVED_CONTEXT_FIELDS)[number];

export const CONTEXT_FIELD_LABELS: Record<ApprovedContextField, string> = {
  caller_name: 'Caller Name (person on the phone)',
  attorney_name: 'Attorney Name',
  law_firm_name: 'Law Firm Name',
  law_firm_phone_number: 'Law Firm Callback Phone',
  law_firm_email_address: 'Law Firm Email',
  law_firm_fax_number: 'Law Firm Fax',
  law_firm_mailing_address: 'Law Firm Mailing Address',
  representation_status: 'Representation Status',

  client_full_name: 'Client Full Name',
  client_name_phonetic: 'Client Name Phonetic Spelling',
  client_date_of_birth: 'Client Date of Birth',
  client_phone_number: 'Client Phone Number',
  client_zip_code: 'Client ZIP Code',
  client_city: 'Client City',
  client_address: 'Client Full Address',
  accident_state: 'Accident State',

  insurance_carrier: 'Insurance Carrier',
  policy_number: 'Policy Number',
  policy_type: 'Policy Type (auto, homeowners, etc.)',
  policyholder_status: 'Policyholder Status (yes / no / third party)',
  insured_name: 'Insured / Policyholder Name',
  client_role_in_loss: "Client's Role (driver, passenger, pedestrian…)",
  insured_vehicle_description: "Insured's Vehicle (year / make / model)",
  existing_claim_number: 'Claim Number',
  claim_number_spoken: 'How to Say the Claim Number',
  date_of_loss: 'Date of Loss',
  time_of_loss: 'Time of Loss',
  location_of_loss: 'Location of Loss',
  incident_type: 'Incident Type (accident, glass, roadside, etc.)',
  case_type: 'Case Type',
  brief_incident_description: 'Brief Incident Description (no injuries or fault)',

  vehicle_year: 'Vehicle Year',
  vehicle_make: 'Vehicle Make',
  vehicle_model: 'Vehicle Model',
  vehicle_identification_number: 'VIN',
  vehicle_location_city: 'Vehicle Location City',

  target_department: 'Target Department',
  known_adjuster_name: 'Known Adjuster Name',
  known_adjuster_phone: 'Known Adjuster Phone',
  known_adjuster_extension: 'Known Adjuster Extension',
  known_adjuster_email: 'Known Adjuster Email',

  lor_sent_date: 'Letter of Representation Sent Date',
  demand_sent_date: 'Demand Sent Date',
  documents_previously_sent: 'Documents Previously Sent',
  preferred_document_delivery: 'Preferred Document Delivery (email / fax)',

  police_report_number: 'Police Report Number',
  other_approved_notes: 'Other Approved Notes (no injuries or fault)',
};

export const CONTEXT_FIELD_PLACEHOLDERS: Partial<
  Record<ApprovedContextField, string>
> = {
  caller_name: 'e.g. Claudia Rodriguez',
  client_full_name: 'e.g. Arleo Perez Castillo',
  client_name_phonetic: 'e.g. Ar-LEE-oh PAIR-ez cas-TEE-yo',
  client_date_of_birth: 'MM/DD/YYYY',
  client_zip_code: 'e.g. 78704',
  policy_number: 'e.g. 4578908453',
  policy_type: 'auto',
  policyholder_status: 'No — calling as attorney for the client (third party)',
  insured_name: 'Third party: the other driver. First party: our client or their household member',
  client_role_in_loss: 'e.g. driver of vehicle 2',
  insured_vehicle_description: 'e.g. 2019 Toyota Camry',
  existing_claim_number: 'e.g. 8896594470000001 or 53-60M2-24J',
  claim_number_spoken:
    'e.g. eight eight nine… then zero zero zero zero zero zero one',
  date_of_loss: 'MM/DD/YYYY',
  incident_type: 'accident',
  accident_state: 'Texas',
  vehicle_year: '2022',
  vehicle_make: 'Mitsubishi',
  vehicle_model: 'Outlander',
  target_department: 'e.g. Total Loss / Property Damage / PIP',
  known_adjuster_extension: 'e.g. 79848',
  law_firm_email_address: 'e.g. intake@ramosjames.com',
  law_firm_fax_number: 'e.g. (512) 555-0100',
  preferred_document_delivery: 'email',
  representation_status: 'Firm represents the client; LOR on file',
};

export interface ContextFieldGroup {
  id: string;
  title: string;
  description: string;
  fields: readonly ApprovedContextField[];
  primary?: boolean;
}

/** UI grouping based on what carriers actually ask for on these calls */
export const CONTEXT_FIELD_GROUPS: readonly ContextFieldGroup[] = [
  {
    id: 'identity',
    title: 'Who is calling',
    description:
      'How the bot introduces itself to IVR and human reps (Geico, State Farm, USAA all ask this).',
    fields: [
      'caller_name',
      'attorney_name',
      'law_firm_name',
      'law_firm_phone_number',
      'law_firm_email_address',
      'law_firm_fax_number',
      'representation_status',
    ],
    primary: true,
  },
  {
    id: 'client',
    title: 'Client verification',
    description:
      'Minimum necessary only. DOB, phone, and address stay off unless you turn them on — otherwise the bot says "We don\'t have that information at this time."',
    fields: [
      'client_full_name',
      'client_name_phonetic',
      'client_date_of_birth',
      'client_phone_number',
      'client_zip_code',
      'client_city',
      'client_address',
      'accident_state',
    ],
    primary: true,
  },
  {
    id: 'claim',
    title: 'Policy & claim',
    description:
      'Who the insured is, the client’s role, policy number, and date of loss decide how the carrier opens the claim.',
    fields: [
      'insurance_carrier',
      'insured_name',
      'client_role_in_loss',
      'insured_vehicle_description',
      'policy_number',
      'policy_type',
      'policyholder_status',
      'existing_claim_number',
      'claim_number_spoken',
      'date_of_loss',
      'incident_type',
      'location_of_loss',
      'time_of_loss',
      'case_type',
      'brief_incident_description',
    ],
    primary: true,
  },
  {
    id: 'vehicle',
    title: 'Vehicle',
    description:
      'Year/make/model helps reps pull the right file when claim numbers fail.',
    fields: [
      'vehicle_year',
      'vehicle_make',
      'vehicle_model',
      'vehicle_identification_number',
      'vehicle_location_city',
    ],
    primary: true,
  },
  {
    id: 'routing',
    title: 'Routing & known contacts',
    description:
      'Use when transferring to total loss, PD, PIP, UIM, or a named adjuster.',
    fields: [
      'target_department',
      'known_adjuster_name',
      'known_adjuster_phone',
      'known_adjuster_extension',
      'known_adjuster_email',
    ],
    primary: true,
  },
  {
    id: 'docs',
    title: 'Prior documents & delivery',
    description:
      'LOR/demand dates and delivery preferences for document requests.',
    fields: [
      'lor_sent_date',
      'demand_sent_date',
      'documents_previously_sent',
      'preferred_document_delivery',
      'law_firm_mailing_address',
    ],
  },
  {
    id: 'other',
    title: 'Other notes',
    description:
      'Anything else approved for this call. Never enter injuries, medical details, or fault/liability statements.',
    fields: ['police_report_number', 'other_approved_notes'],
  },
] as const;

/** Fields most often needed across open-claim and follow-up calls */
export const PRIMARY_CONTEXT_FIELDS: readonly ApprovedContextField[] =
  CONTEXT_FIELD_GROUPS.filter((g) => g.primary).flatMap((g) => [...g.fields]);

/**
 * Personal identifiers that are never pre-selected, even when the case has a value.
 * A user must turn them on deliberately for a specific call.
 */
export const WITHHELD_BY_DEFAULT_FIELDS: readonly ApprovedContextField[] = [
  'client_date_of_birth',
  'client_phone_number',
  'client_address',
];

/** What the agent says when asked for personal information it does not have approved. */
export const NOT_AVAILABLE_RESPONSE = "We don't have that information at this time.";

export const RESTRICTED_FIELDS = [
  'social_security_number',
  'drivers_license_number',
  'banking_information',
  'payment_card_information',
  'injuries',
  'symptoms',
  'medical_condition',
  'medical_treatment',
  'medical_records',
  'diagnoses',
  'prognosis',
  'bodily_injury_status',
  'fault_or_liability',
  'settlement_strategy',
  'internal_attorney_analysis',
  'unrelated_case_notes',
  'unrelated_communications',
] as const;

export type RestrictedField = (typeof RESTRICTED_FIELDS)[number];

/**
 * Field keys that must never reach the voice agent, even if a stored mission
 * (or a hand-edited request) marks them as included.
 */
const NEVER_DISCLOSED_FIELD_PATTERN =
  /injur|symptom|medical|treatment|diagnos|prognos|bodily|health|fault|liabil|(^|_)ssn(_|$)|social_security|driver_?s?_licen/i;

export function isNeverDisclosedField(field: string): boolean {
  return (
    (RESTRICTED_FIELDS as readonly string[]).includes(field) ||
    NEVER_DISCLOSED_FIELD_PATTERN.test(field)
  );
}

/** Statement the agent must use when asked about injuries, medical status, fault, or liability. */
export const BODILY_INJURY_LIABILITY_REFUSAL =
  "I'm not authorized to discuss the client's injuries, medical condition, or any fault or liability questions. Please contact our firm directly regarding bodily-injury or liability matters.";

export interface ApprovedContextEntry {
  field: ApprovedContextField;
  label: string;
  value: string;
  included: boolean;
  missionSpecificValue?: string;
}
