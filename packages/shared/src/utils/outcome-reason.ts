import type { MissionOutcome } from '../types/call-status.js';
import type { OutcomeReason } from '../types/mission-types.js';

export interface OutcomeReasonInput {
  /** Reason reported by the agent's end_call, or classified from the transcript. */
  reported: OutcomeReason | null;
  escalated: boolean;
  reachedHuman: boolean;
  hasClaim: boolean;
  missingRequiredCount: number;
}

export function resolveOutcomeReason(input: OutcomeReasonInput): OutcomeReason {
  const claimIncomplete = input.hasClaim && input.missingRequiredCount > 0;

  if (input.reported) {
    if (input.reported === 'completed' && claimIncomplete) {
      return 'missing_required_information';
    }
    return input.reported;
  }

  if (input.escalated) return 'human_follow_up_required';
  if (!input.reachedHuman) return 'unable_to_reach_representative';
  if (claimIncomplete) return 'missing_required_information';
  if (input.hasClaim) return 'completed';
  return 'human_follow_up_required';
}

export const MISSION_OUTCOME_FOR_REASON: Record<OutcomeReason, MissionOutcome> = {
  completed: 'success',
  missing_required_information: 'partial_success',
  carrier_refused_ai: 'failure',
  unable_to_reach_representative: 'failure',
  ai_declined_restricted_request: 'human_follow_up',
  human_follow_up_required: 'human_follow_up',
};
