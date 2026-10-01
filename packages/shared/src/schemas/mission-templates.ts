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
  "The client's injuries, symptoms, medical condition, treatment, prognosis, or bodily-injury status — never disclose, confirm, deny, characterize, or speculate (including never saying the client is uninjured or fine)",
  'Fault, liability, or how the accident happened in a way that assigns blame',
  'Settlement value negotiation beyond confirming amounts the carrier already stated',
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
  'The carrier will not proceed without identity data the AI does not have approved (e.g. SSN, DOB)',
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
  'Client name',
  'Date of loss',
  'Policy number when available',
  'Claim number when available',
  'Vehicle year/make/model when available',
  'Representation status',
  'High-level purpose of the call',
  'Only the minimum needed to open or locate the claim, and only when asked',
] as const;

const REQUIRED_OUTPUT_OBJECTIVE =
  'Before ending, obtain the claim number plus the adjuster’s full name, phone, fax, email, and mailing address (needed for the Letter of Representation). If no adjuster is assigned yet, get the general claims fax, email, and mailing address.';

export const OPEN_CLAIM_THIRD_PARTY_TEMPLATE = {
  name: 'Open Claim — Third Party',
  missionType: 'open_claim_third_party' as const,
  description:
    "Open a third-party claim for our client against the other driver's policy. The insured is the other driver, not our client.",
  defaultGoal:
    "Open a third-party claim on behalf of the firm's client against the carrier's insured, and leave with the claim number and full adjuster contact information.",
  defaultObjectives: [
    'Navigate the carrier IVR: claims → report/file a new claim → not a policyholder / third party / attorney',
    "Identify as calling from the law firm on behalf of our client, who is a claimant against the carrier's insured",
    "Provide only what is needed to open the claim: the insured's name, the insured's policy number if known, date of loss, location, the client's name, and the client's role (e.g. driver/passenger)",
    'If a claim already exists for this loss, get that claim number instead of opening a duplicate',
    REQUIRED_OUTPUT_OBJECTIVE,
    'Note any documents the carrier asks the firm to send',
  ],
  defaultSuccessCriteria: [
    'A claim number is obtained (new or existing)',
    'Adjuster name, phone, fax, email, and mailing address are recorded — or the reason any are unavailable',
  ],
  defaultAllowedDisclosures: [
    ...SHARED_DISCLOSURES,
    "The carrier's insured's name and vehicle, as provided in approved context",
    "The client's role in the loss (driver, passenger, pedestrian) — never how the accident happened or who caused it",
  ],
  defaultRestrictedTopics: [...SHARED_RESTRICTED],
  defaultEscalationRules: [...SHARED_ESCALATION],
  expectedOutputSchema: null,
  isActive: true,
} as const;

export const OPEN_CLAIM_FIRST_PARTY_TEMPLATE = {
  name: 'Open Claim — First Party / UM-UIM',
  missionType: 'open_claim_first_party' as const,
  description:
    "Open a first-party (UM/UIM) claim under our client's own policy. Our client — or their household member — is the insured.",
  defaultGoal:
    "Open a first-party UM/UIM claim under the client's own policy on the firm's behalf, and leave with the claim number and full adjuster contact information.",
  defaultObjectives: [
    'Navigate the carrier IVR: claims → report/file a new claim → attorney / calling on behalf of the policyholder',
    "Identify as calling from the law firm on behalf of the carrier's own insured (our client)",
    "Provide only what is needed to locate the policy and open the claim: the insured's name, policy number, date of loss, location, and vehicle",
    'Ask to open an uninsured / underinsured motorist (UM/UIM) claim; if a claim already exists for this loss, ask to have UM/UIM noted on that claim and get its number',
    REQUIRED_OUTPUT_OBJECTIVE,
    'Note any documents the carrier asks the firm to send',
  ],
  defaultSuccessCriteria: [
    'A claim number is obtained (new or existing) with UM/UIM noted',
    'Adjuster name, phone, fax, email, and mailing address are recorded — or the reason any are unavailable',
  ],
  defaultAllowedDisclosures: [...SHARED_DISCLOSURES],
  defaultRestrictedTopics: [...SHARED_RESTRICTED],
  defaultEscalationRules: [...SHARED_ESCALATION],
  expectedOutputSchema: null,
  isActive: true,
} as const;

export const OPEN_INSURANCE_CLAIM_TEMPLATE = {
  name: 'Open Insurance Claim (legacy)',
  missionType: 'open_insurance_claim' as const,
  description:
    'Legacy combined open-claim mission. New calls use the first-party or third-party types.',
  defaultGoal:
    "Open a new auto claim on behalf of the firm's client and collect the claim number plus any claims contact information.",
  defaultObjectives: [
    'Navigate the carrier IVR (claims / file new claim / attorney / not a policyholder as applicable)',
    'Identify as calling from the law firm on behalf of the client',
    'Provide approved policy, client, date-of-loss, and vehicle information',
    'Open the claim or confirm if a claim already exists',
    REQUIRED_OUTPUT_OBJECTIVE,
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
    'Verify with claim number, client name, and date of loss (only use other identifiers if approved and asked)',
    'State the call purpose clearly (status, total loss, PD, inspection follow-up, etc.)',
    'Confirm claim status and assigned department/adjuster',
    REQUIRED_OUTPUT_OBJECTIVE,
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
    'Identify the PD / total-loss / BI / PIP adjuster and get contact info or a warm transfer.',
  defaultGoal:
    'Identify the correct adjuster for this claim and obtain direct contact information or a transfer.',
  defaultObjectives: [
    'Navigate to claims and verify the existing claim',
    'Ask for the relevant adjuster (PD, total loss, PIP, UIM, BI) by department name only — do not describe the client\'s condition',
    REQUIRED_OUTPUT_OBJECTIVE,
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
  defaultAllowedDisclosures: [...SHARED_DISCLOSURES, 'That a PIP demand was sent'],
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
  open_claim_third_party: OPEN_CLAIM_THIRD_PARTY_TEMPLATE,
  open_claim_first_party: OPEN_CLAIM_FIRST_PARTY_TEMPLATE,
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
  open_claim_third_party: [
    'caller_name',
    'law_firm_name',
    'law_firm_phone_number',
    'law_firm_email_address',
    'law_firm_fax_number',
    'law_firm_mailing_address',
    'representation_status',
    'client_full_name',
    'client_role_in_loss',
    'insured_name',
    'insured_vehicle_description',
    'insurance_carrier',
    'policy_number',
    'policyholder_status',
    'date_of_loss',
    'location_of_loss',
    'accident_state',
  ],
  open_claim_first_party: [
    'caller_name',
    'law_firm_name',
    'law_firm_phone_number',
    'law_firm_email_address',
    'law_firm_fax_number',
    'law_firm_mailing_address',
    'representation_status',
    'client_full_name',
    'insured_name',
    'insurance_carrier',
    'policy_number',
    'policy_type',
    'policyholder_status',
    'date_of_loss',
    'location_of_loss',
    'accident_state',
    'vehicle_year',
    'vehicle_make',
    'vehicle_model',
  ],
  open_insurance_claim: [
    'caller_name',
    'law_firm_name',
    'law_firm_phone_number',
    'law_firm_email_address',
    'representation_status',
    'client_full_name',
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
