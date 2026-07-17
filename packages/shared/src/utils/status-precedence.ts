import { CallStatus } from '../types/call-status.js';

const STATUS_PRECEDENCE: Record<CallStatus, number> = {
  draft: 0,
  authorized: 1,
  queued: 2,
  initiating: 3,
  dialing: 4,
  ringing: 5,
  answered: 6,
  in_progress: 7,
  on_hold: 8,
  completed: 10,
  failed: 10,
  cancelled: 10,
  needs_human_follow_up: 11,
  awaiting_review: 12,
  reviewed: 13,
};

export function canTransitionStatus(current: CallStatus, next: CallStatus): boolean {
  if (current === next) return false;

  const currentPrecedence = STATUS_PRECEDENCE[current];
  const nextPrecedence = STATUS_PRECEDENCE[next];

  if (currentPrecedence === undefined || nextPrecedence === undefined) return false;

  // Terminal statuses (completed, failed, cancelled) can only move forward to review states
  if (currentPrecedence >= 10 && nextPrecedence < 10) return false;

  // on_hold can go back to in_progress
  if (current === 'on_hold' && next === 'in_progress') return true;

  return nextPrecedence > currentPrecedence;
}

export function getStatusPrecedence(status: CallStatus): number {
  return STATUS_PRECEDENCE[status] ?? -1;
}

export function isTerminalStatus(status: CallStatus): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

export function isActiveStatus(status: CallStatus): boolean {
  return ['initiating', 'dialing', 'ringing', 'answered', 'in_progress', 'on_hold'].includes(status);
}
