export const CALL_STATUSES = [
  'draft',
  'authorized',
  'queued',
  'initiating',
  'dialing',
  'ringing',
  'answered',
  'in_progress',
  'on_hold',
  'completed',
  'failed',
  'cancelled',
  'needs_human_follow_up',
  'awaiting_review',
  'reviewed',
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

export const MISSION_OUTCOMES = [
  'success',
  'partial_success',
  'failure',
  'human_follow_up',
] as const;

export type MissionOutcome = (typeof MISSION_OUTCOMES)[number];

export const REVIEW_STATUSES = [
  'pending',
  'accepted',
  'edited',
  'rejected',
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
