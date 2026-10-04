import type { IntakeFacts } from './facts.js';
import type { QualificationOutcome } from './qualification.js';
import type { InboundIntakeStatus, InboundLanguage, NextAction } from './types.js';

export interface TransferAttempt {
  destination: string;
  label: 'primary' | 'backup' | 'existing_client';
  startedAt: string;
  success: boolean | null;
  failureReason: string | null;
}

export interface ContractState {
  offered: boolean;
  offeredAt: string | null;
  sent: boolean;
  provider: string | null;
  externalId: string | null;
  sentAt: string | null;
  delivery: 'sms' | 'email' | null;
  resends: number;
  viewed: boolean;
  viewedAt: string | null;
  signed: boolean;
  signedAt: string | null;
  /** Caller declined in the e-sign tool, or the request expired. */
  closedReason: 'declined' | 'expired' | null;
  lastError: string | null;
}

export interface CallbackRequest {
  priority: 'urgent' | 'normal';
  reason: string;
  preferredTime: string | null;
  phone: string | null;
  requestedAt: string;
}

/** Everything the tool executor reads and writes for one intake. */
export interface InboundIntakeState {
  intakeId: string;
  callId: string;
  status: InboundIntakeStatus;
  language: InboundLanguage;
  facts: IntakeFacts;
  qualification: QualificationOutcome | null;
  highPriority: boolean;
  highPriorityReasons: string[];
  needsReviewReasons: string[];
  transfers: TransferAttempt[];
  transferInProgress: boolean;
  contract: ContractState;
  callbacks: CallbackRequest[];
  smsSent: Array<{ type: string; at: string }>;
  completed: boolean;
  recommendedNextAction: NextAction | null;
  /** Caller's own number (from caller ID), used when they don't give another. */
  callerIdNumber: string | null;
}

export function emptyContractState(): ContractState {
  return {
    offered: false,
    offeredAt: null,
    sent: false,
    provider: null,
    externalId: null,
    sentAt: null,
    delivery: null,
    resends: 0,
    viewed: false,
    viewedAt: null,
    signed: false,
    signedAt: null,
    closedReason: null,
    lastError: null,
  };
}

export function newIntakeState(input: {
  intakeId: string;
  callId: string;
  callerIdNumber?: string | null;
  language?: InboundLanguage;
}): InboundIntakeState {
  return {
    intakeId: input.intakeId,
    callId: input.callId,
    status: 'active',
    language: input.language ?? 'en',
    facts: {},
    qualification: null,
    highPriority: false,
    highPriorityReasons: [],
    needsReviewReasons: [],
    transfers: [],
    transferInProgress: false,
    contract: emptyContractState(),
    callbacks: [],
    smsSent: [],
    completed: false,
    recommendedNextAction: null,
    callerIdNumber: input.callerIdNumber ?? null,
  };
}
