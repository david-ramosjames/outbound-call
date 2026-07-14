export const MISSION_TYPES = [
  'open_insurance_claim',
] as const;

export type MissionType = (typeof MISSION_TYPES)[number];

export const APPROVED_CONTEXT_FIELDS = [
  'client_full_name',
  'client_date_of_birth',
  'client_address',
  'client_phone_number',
  'date_of_loss',
  'time_of_loss',
  'location_of_loss',
  'case_type',
  'brief_incident_description',
  'insured_name',
  'insurance_carrier',
  'policy_number',
  'existing_claim_number',
  'vehicle_year',
  'vehicle_make',
  'vehicle_model',
  'vehicle_identification_number',
  'police_report_number',
  'attorney_name',
  'law_firm_name',
  'law_firm_phone_number',
  'law_firm_email_address',
  'law_firm_mailing_address',
  'representation_status',
  'other_approved_notes',
] as const;

export type ApprovedContextField = (typeof APPROVED_CONTEXT_FIELDS)[number];

export const RESTRICTED_FIELDS = [
  'social_security_number',
  'banking_information',
  'payment_card_information',
  'full_medical_records',
  'detailed_diagnoses',
  'treatment_history',
  'settlement_strategy',
  'internal_attorney_analysis',
  'unrelated_case_notes',
  'unrelated_communications',
] as const;

export type RestrictedField = (typeof RESTRICTED_FIELDS)[number];

export interface ApprovedContextEntry {
  field: ApprovedContextField;
  label: string;
  value: string;
  included: boolean;
  missionSpecificValue?: string;
}
