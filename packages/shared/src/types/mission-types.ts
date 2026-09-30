export const MISSION_TYPES = [
  'open_insurance_claim',
  'follow_up_existing_claim',
  'request_adjuster_contact',
  'request_claim_documents',
  'pip_follow_up',
] as const;

export type MissionType = (typeof MISSION_TYPES)[number];

export const MISSION_TYPE_LABELS: Record<MissionType, string> = {
  open_insurance_claim: 'Open a new claim',
  follow_up_existing_claim: 'Follow up on existing claim',
  request_adjuster_contact: 'Get adjuster / transfer',
  request_claim_documents: 'Request claim documents',
  pip_follow_up: 'PIP / medical benefits follow-up',
};

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
  insured_name: 'Insured Name (if different from client)',
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
      'DOB, phone, ZIP, and name spelling are repeatedly requested by carrier IVRs.',
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
      'Policy number, claim number, date of loss, and policyholder status are core routing inputs.',
    fields: [
      'insurance_carrier',
      'policy_number',
      'policy_type',
      'policyholder_status',
      'insured_name',
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

export const RESTRICTED_FIELDS = [
  'social_security_number',
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
  /injur|symptom|medical|treatment|diagnos|prognos|bodily|health|fault|liabil/i;

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
