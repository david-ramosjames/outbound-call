export const INBOUND_INTAKE_STATUSES = [
  'active',
  'incomplete',
  'qualified',
  'needs_review',
  'transferred',
  'contract_sent',
  'contract_signed',
  'declined',
  'spam',
  'existing_client',
  'other',
] as const;
export type InboundIntakeStatus = (typeof INBOUND_INTAKE_STATUSES)[number];

export const INBOUND_CASE_TYPES = [
  'motor_vehicle',
  'trucking',
  'pedestrian',
  'bicycle',
  'motorcycle',
  'premises_liability',
  'wrongful_death',
  'dog_bite',
  'other_personal_injury',
  'unknown',
] as const;
export type InboundCaseType = (typeof INBOUND_CASE_TYPES)[number];

export const INBOUND_CASE_TYPE_LABELS: Record<InboundCaseType, string> = {
  motor_vehicle: 'Motor vehicle accident',
  trucking: 'Trucking accident',
  pedestrian: 'Pedestrian',
  bicycle: 'Bicycle',
  motorcycle: 'Motorcycle',
  premises_liability: 'Premises liability',
  wrongful_death: 'Wrongful death',
  dog_bite: 'Dog bite',
  other_personal_injury: 'Other personal injury',
  unknown: 'Unknown / needs review',
};

export const INBOUND_CALLER_TYPES = ['new_potential_client', 'existing_client', 'other'] as const;
export type InboundCallerType = (typeof INBOUND_CALLER_TYPES)[number];

export const QUALIFICATION_RESULTS = [
  'high_priority',
  'qualified',
  'needs_review',
  'not_qualified',
] as const;
export type QualificationResultValue = (typeof QUALIFICATION_RESULTS)[number];

export const QUALIFICATION_RESULT_LABELS: Record<QualificationResultValue, string> = {
  high_priority: 'High priority',
  qualified: 'Qualified',
  needs_review: 'Possibly qualified / human review',
  not_qualified: 'Not currently qualified',
};

export const BUSINESS_STATUSES = ['business_hours', 'after_hours', 'closed'] as const;
export type BusinessStatusValue = (typeof BUSINESS_STATUSES)[number];

export const INBOUND_LANGUAGES = ['en', 'es'] as const;
export type InboundLanguage = (typeof INBOUND_LANGUAGES)[number];

export const INJURY_SEVERITIES = [
  'none',
  'minor',
  'moderate',
  'severe',
  'catastrophic',
  'unknown',
] as const;
export type InjurySeverity = (typeof INJURY_SEVERITIES)[number];

export const INBOUND_CALL_STATUSES = [
  'ringing',
  'in_progress',
  'transferring',
  'transferred',
  'completed',
  'failed',
] as const;
export type InboundCallStatus = (typeof INBOUND_CALL_STATUSES)[number];

export const AUDIT_EVENT_TYPES = [
  'CALL_STARTED',
  'LANGUAGE_CHANGED',
  'INTAKE_UPDATED',
  'QUALIFICATION_RUN',
  'QUALIFICATION_CHANGED',
  'HIGH_PRIORITY_DETECTED',
  'NEEDS_REVIEW_MARKED',
  'TRANSFER_ATTEMPTED',
  'TRANSFER_SUCCEEDED',
  'TRANSFER_FAILED',
  'CONTRACT_OFFERED',
  'CONTRACT_SENT',
  'CONTRACT_SEND_FAILED',
  'CONTRACT_RESENT',
  'CONTRACT_VIEWED',
  'CONTRACT_SIGNED',
  'CONTRACT_DECLINED',
  'CALLBACK_REQUESTED',
  'SMS_SENT',
  'SMS_FAILED',
  'GUARDRAIL_FLAGGED',
  'TOOL_REJECTED',
  'INTAKE_COMPLETED',
  'CALL_COMPLETED',
  'SETTINGS_CHANGED',
  'INSTRUCTIONS_CHANGED',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AUDIT_ACTORS = ['AI', 'SYSTEM', 'ADMIN', 'HUMAN'] as const;
export type AuditActor = (typeof AUDIT_ACTORS)[number];

export const NEXT_ACTIONS = [
  'identify_caller',
  'continue_intake',
  'collect_minimum_contact',
  'offer_transfer',
  'offer_contract',
  'help_sign_agreement',
  'request_callback',
  'take_message',
  'decline_politely',
  'complete_intake',
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];
