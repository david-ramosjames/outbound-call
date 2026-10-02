import { z } from 'zod';
import {
  INBOUND_CALLER_TYPES,
  INBOUND_CASE_TYPES,
  INBOUND_LANGUAGES,
  INJURY_SEVERITIES,
} from './types.js';

const optStr = z.string().trim().min(1).nullable().optional();
const optBool = z.boolean().nullable().optional();

/**
 * Everything the intake engine knows about the caller and the incident.
 * Every field is optional: callers rarely know everything, and facts arrive in any order.
 */
export const intakeFactsSchema = z.object({
  caller_type: z.enum(INBOUND_CALLER_TYPES).nullable().optional(),
  caller_name: optStr,
  phone: optStr,
  email: optStr,
  preferred_language: z.enum(INBOUND_LANGUAGES).nullable().optional(),
  caller_relationship_to_injured_person: optStr,
  injured_person_name: optStr,

  case_type: z.enum(INBOUND_CASE_TYPES).nullable().optional(),
  incident_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'incident_date must be YYYY-MM-DD')
    .nullable()
    .optional(),
  incident_date_text: optStr,
  incident_city: optStr,
  incident_state: optStr,
  incident_location: optStr,
  incident_description: optStr,

  injury_description: optStr,
  injury_severity: z.enum(INJURY_SEVERITIES).nullable().optional(),
  medical_treatment: optBool,
  medical_treatment_description: optStr,
  hospitalized: optBool,
  surgery: optBool,
  hospital_or_provider: optStr,

  police_report: optBool,
  police_report_number: optStr,
  other_party: optStr,
  commercial_vehicle_involved: optBool,
  trucking_company: optStr,
  insurance_information: optStr,

  represented_by_attorney: optBool,
  previous_attorney: optStr,

  fault_summary: optStr,
  caller_at_fault: z.enum(['no', 'yes', 'partial', 'unknown']).nullable().optional(),

  property_damage: optStr,
  work_missed: optStr,
  witnesses: optStr,
  photos_or_video: optBool,

  statute_or_deadline_concern: optBool,
  minor_involved: optBool,
  minor_seriously_injured: optBool,
  fatality: optBool,
  multiple_injured: optBool,

  existing_client_case_reference: optStr,
  existing_client_reason: optStr,
  other_call_reason: optStr,

  declined_to_provide: z.array(z.string()).optional(),
  case_specific: z.record(z.string()).optional(),
});

export type IntakeFacts = z.infer<typeof intakeFactsSchema>;
export type IntakeFactKey = keyof IntakeFacts;

export const INTAKE_FACT_KEYS = Object.keys(intakeFactsSchema.shape) as IntakeFactKey[];

export const INTAKE_FACT_LABELS: Partial<Record<IntakeFactKey, string>> = {
  caller_type: 'Caller type',
  caller_name: 'Caller name',
  phone: 'Phone',
  email: 'Email',
  preferred_language: 'Preferred language',
  caller_relationship_to_injured_person: 'Relationship to injured person',
  injured_person_name: 'Injured person',
  case_type: 'Case type',
  incident_date: 'Incident date',
  incident_city: 'Incident city',
  incident_state: 'Incident state',
  incident_location: 'Incident location',
  incident_description: 'What happened',
  injury_description: 'Injuries',
  injury_severity: 'Injury severity',
  medical_treatment: 'Received medical treatment',
  medical_treatment_description: 'Treatment',
  hospitalized: 'Hospitalized',
  surgery: 'Surgery',
  hospital_or_provider: 'Hospital / provider',
  police_report: 'Police report',
  police_report_number: 'Police report #',
  other_party: 'Other party',
  commercial_vehicle_involved: 'Commercial vehicle',
  trucking_company: 'Trucking company',
  insurance_information: 'Insurance',
  represented_by_attorney: 'Already has an attorney',
  previous_attorney: 'Previous attorney',
  fault_summary: 'Fault facts',
  caller_at_fault: 'Caller at fault',
  property_damage: 'Property damage',
  work_missed: 'Work missed',
  witnesses: 'Witnesses',
  photos_or_video: 'Photos / video',
  statute_or_deadline_concern: 'Deadline concern',
  minor_involved: 'Minor involved',
  minor_seriously_injured: 'Minor seriously injured',
  fatality: 'Fatality',
  multiple_injured: 'Multiple injured',
  existing_client_case_reference: 'Existing case reference',
  existing_client_reason: 'Reason for call (existing client)',
  other_call_reason: 'Reason for call',
};
