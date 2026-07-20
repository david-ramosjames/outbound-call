import { z } from 'zod';
import { MISSION_TYPES, type MissionType } from '../types/mission-types.js';

export const missionTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  missionType: z.enum(MISSION_TYPES),
  description: z.string(),
  defaultGoal: z.string(),
  defaultObjectives: z.array(z.string()),
  defaultSuccessCriteria: z.array(z.string()),
  defaultAllowedDisclosures: z.array(z.string()),
  defaultRestrictedTopics: z.array(z.string()),
  defaultEscalationRules: z.array(z.string()),
  expectedOutputSchema: z.record(z.unknown()).nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MissionTemplate = z.infer<typeof missionTemplateSchema>;

const SHARED_RESTRICTED = [
  'Settlement value negotiation beyond confirming amounts the carrier already stated',
  'Liability admissions',
  'Detailed medical diagnoses or treatment history',
  'Legal strategy',
  'Client statements beyond confirming identity',
  'Social security numbers',
  'Banking or payment information',
  'Unrelated case information',
] as const;

const SHARED_ESCALATION = [
  'Legal advice or judgment is requested',
  'The representative requests a client statement',
  'The representative requests an attorney statement',
  'Settlement negotiation beyond the mission scope is requested',
  'Liability admissions are requested',
  'The AI is asked to verify identity using unavailable or restricted data (e.g. SSN)',
  'A dispute develops that cannot be resolved with approved facts',
  'Sensitive information outside the approved context is requested',
  'A representative refuses to speak with an AI',
  'The representative requests a human from the firm',
  'The AI is not confident it has the correct answer',
  'The requested action exceeds the defined mission',
] as const;

const SHARED_DISCLOSURES = [
  'Law firm name and contact information',
  'Caller / attorney name',
  'Client name and DOB when approved',
  'Client phone and ZIP when approved',
  'Date of loss',
  'Policy number when available',
  'Claim number when available',
  'Vehicle year/make/model when available',
  'Representation status',
  'High-level purpose of the call',
] as const;

export const OPEN_INSURANCE_CLAIM_TEMPLATE = {
  name: 'Open Insurance Claim',
  missionType: 'open_insurance_claim' as const,
  description:
    'Open a new claim (often as a third-party / non-policyholder attorney caller) and collect claim + adjuster info.',
  defaultGoal:
    "Open a new auto claim on behalf of the firm's client and collect the claim number plus any claims contact information.",
  defaultObjectives: [
    'Navigate the carrier IVR (claims / file new claim / attorney / not a policyholder as applicable)',
    'Identify as calling from the law firm on behalf of the client',
    'Provide approved policy, client, date-of-loss, and vehicle information',
    'Open the claim or confirm if a claim already exists',
    'Obtain the claim number and read it back digit-by-digit',
    'Obtain adjuster name, phone, email, and/or general claims fax/email',
    'Identify any requested documentation and next steps',
  ],
  defaultSuccessCriteria: [
    'A claim number is obtained or confirmed already open',
    'At least one usable follow-up contact method is recorded',
  ],
  defaultAllowedDisclosures: [...SHARED_DISCLOSURES],
  defaultRestrictedTopics: [...SHARED_RESTRICTED],
  defaultEscalationRules: [...SHARED_ESCALATION],
  expectedOutputSchema: null,
  isActive: true,
} as const;

export const FOLLOW_UP_EXISTING_CLAIM_TEMPLATE = {
  name: 'Follow Up Existing Claim',
  missionType: 'follow_up_existing_claim' as const,
  description:
    'Reach claims on an existing claim for status, total-loss/PD clarification, or next steps.',
  defaultGoal:
    'Reach the correct claims unit on an existing claim, confirm status, and collect the next action and contacts.',
  defaultObjectives: [
    'Navigate IVR for existing claim / claims / attorney path',
    'Verify with claim number, client name, DOB, phone, and ZIP as needed',
    'State the call purpose clearly (status, total loss, PD, inspection follow-up, etc.)',
    'Confirm claim status and assigned department/adjuster',
    'Collect direct phone, extension, and email when available',
    'Confirm any documents already on file and what still needs to be sent',
    'Record promised next steps and follow-up timing',
  ],
  defaultSuccessCriteria: [
    'Spoke with a human claims representative or left a complete voicemail',
    'Claim status and next step are recorded',
  ],
  defaultAllowedDisclosures: [...SHARED_DISCLOSURES],
  defaultRestrictedTopics: [...SHARED_RESTRICTED],
  defaultEscalationRules: [...SHARED_ESCALATION],
  expectedOutputSchema: null,
  isActive: true,
} as const;

export const REQUEST_ADJUSTER_CONTACT_TEMPLATE = {
  name: 'Get Adjuster / Transfer',
  missionType: 'request_adjuster_contact' as const,
  description:
    'Identify the PD / total-loss / injury / PIP adjuster and get contact info or a warm transfer.',
  defaultGoal:
    'Identify the correct adjuster for this claim and obtain direct contact information or a transfer.',
  defaultObjectives: [
    'Navigate to claims and verify the existing claim',
    'Ask for the relevant adjuster (PD, total loss, PIP, UIM, injury team)',
    'Spell and confirm adjuster name',
    'Obtain direct phone and/or extension',
    'Obtain email if available',
    'Accept a transfer when offered and re-introduce after transfer',
    'If voicemail, leave firm name, claim number, client name, callback number, and reason',
  ],
  defaultSuccessCriteria: [
    'Adjuster name plus at least one direct contact method is obtained, or a transfer/voicemail is completed',
  ],
  defaultAllowedDisclosures: [...SHARED_DISCLOSURES],
  defaultRestrictedTopics: [...SHARED_RESTRICTED],
  defaultEscalationRules: [...SHARED_ESCALATION],
  expectedOutputSchema: null,
  isActive: true,
} as const;

export const REQUEST_CLAIM_DOCUMENTS_TEMPLATE = {
  name: 'Request Claim Documents',
  missionType: 'request_claim_documents' as const,
  description:
    'Request PD docs, photos, total-loss evaluation, correspondence, or declaration page.',
  defaultGoal:
    'Request the approved claim documents and confirm delivery method, recipient, and timing.',
  defaultObjectives: [
    'Verify the claim and representation',
    'Request specific documents (evaluation, photos, letters, dec page, etc.)',
    'Provide firm email and/or fax for delivery',
    'Confirm whether files were already sent to the client',
    'Record what will be sent, by whom, and when',
    'Capture any buyback / settlement figures the carrier voluntarily states for confirmation only',
  ],
  defaultSuccessCriteria: [
    'Document request is acknowledged with a delivery method and expected timing',
  ],
  defaultAllowedDisclosures: [
    ...SHARED_DISCLOSURES,
    'Firm email and fax for document delivery',
    'Dates LOR or demand were previously sent',
  ],
  defaultRestrictedTopics: [...SHARED_RESTRICTED],
  defaultEscalationRules: [...SHARED_ESCALATION],
  expectedOutputSchema: null,
  isActive: true,
} as const;

export const PIP_FOLLOW_UP_TEMPLATE = {
  name: 'PIP / Medical Benefits Follow-Up',
  missionType: 'pip_follow_up' as const,
  description:
    'Follow up on PIP / medical benefits payment, partial payment, or PIP adjuster contact.',
  defaultGoal:
    'Reach the PIP adjuster or claims unit, confirm payment status on medical bills, and record next steps.',
  defaultObjectives: [
    'Navigate claims IVR (attorney / existing claim / PIP or medical benefits)',
    'Provide claim number, client name, and date of loss',
    'Explain that a PIP demand was sent and payment appears incomplete',
    'Identify the PIP adjuster and direct contact details',
    'Confirm amounts paid, amounts outstanding, and reason for reductions if stated',
    'Leave a clear voicemail if transferred to voicemail',
    'Record any promised callback or documentation request',
  ],
  defaultSuccessCriteria: [
    'PIP payment status is clarified with a named contact or complete voicemail left',
  ],
  defaultAllowedDisclosures: [
    ...SHARED_DISCLOSURES,
    'That a PIP demand was sent',
    'Approximate medical bill totals already in the approved notes',
  ],
  defaultRestrictedTopics: [...SHARED_RESTRICTED],
  defaultEscalationRules: [...SHARED_ESCALATION],
  expectedOutputSchema: null,
  isActive: true,
} as const;

export type MissionTemplateDefaults = {
  name: string;
  missionType: MissionType;
  description: string;
  defaultGoal: string;
  defaultObjectives: readonly string[];
  defaultSuccessCriteria: readonly string[];
  defaultAllowedDisclosures: readonly string[];
  defaultRestrictedTopics: readonly string[];
  defaultEscalationRules: readonly string[];
  expectedOutputSchema: null;
  isActive: boolean;
};

export const MISSION_TEMPLATES_BY_TYPE: Record<MissionType, MissionTemplateDefaults> = {
  open_insurance_claim: OPEN_INSURANCE_CLAIM_TEMPLATE,
  follow_up_existing_claim: FOLLOW_UP_EXISTING_CLAIM_TEMPLATE,
  request_adjuster_contact: REQUEST_ADJUSTER_CONTACT_TEMPLATE,
  request_claim_documents: REQUEST_CLAIM_DOCUMENTS_TEMPLATE,
  pip_follow_up: PIP_FOLLOW_UP_TEMPLATE,
};

/** Suggested fields to auto-include for each mission type */
export const DEFAULT_INCLUDED_FIELDS_BY_MISSION: Record<
  MissionType,
  readonly string[]
> = {
  open_insurance_claim: [
    'caller_name',
    'law_firm_name',
    'law_firm_phone_number',
    'law_firm_email_address',
    'representation_status',
    'client_full_name',
    'client_date_of_birth',
    'client_phone_number',
    'client_zip_code',
    'accident_state',
    'insurance_carrier',
    'policy_number',
    'policy_type',
    'policyholder_status',
    'date_of_loss',
    'incident_type',
    'vehicle_year',
    'vehicle_make',
    'vehicle_model',
  ],
  follow_up_existing_claim: [
    'caller_name',
    'law_firm_name',
    'law_firm_phone_number',
    'law_firm_email_address',
    'representation_status',
    'client_full_name',
    'client_name_phonetic',
    'client_date_of_birth',
    'client_phone_number',
    'client_zip_code',
    'accident_state',
    'insurance_carrier',
    'policy_number',
    'existing_claim_number',
    'claim_number_spoken',
    'date_of_loss',
    'vehicle_year',
    'vehicle_make',
    'vehicle_model',
    'target_department',
  ],
  request_adjuster_contact: [
    'caller_name',
    'law_firm_name',
    'law_firm_phone_number',
    'representation_status',
    'client_full_name',
    'client_date_of_birth',
    'client_phone_number',
    'client_zip_code',
    'existing_claim_number',
    'claim_number_spoken',
    'date_of_loss',
    'target_department',
    'known_adjuster_name',
    'known_adjuster_phone',
    'known_adjuster_extension',
  ],
  request_claim_documents: [
    'caller_name',
    'law_firm_name',
    'law_firm_phone_number',
    'law_firm_email_address',
    'law_firm_fax_number',
    'representation_status',
    'client_full_name',
    'existing_claim_number',
    'claim_number_spoken',
    'date_of_loss',
    'target_department',
    'lor_sent_date',
    'demand_sent_date',
    'documents_previously_sent',
    'preferred_document_delivery',
  ],
  pip_follow_up: [
    'caller_name',
    'attorney_name',
    'law_firm_name',
    'law_firm_phone_number',
    'law_firm_email_address',
    'representation_status',
    'client_full_name',
    'existing_claim_number',
    'claim_number_spoken',
    'date_of_loss',
    'target_department',
    'known_adjuster_name',
    'known_adjuster_extension',
    'demand_sent_date',
    'other_approved_notes',
  ],
};
