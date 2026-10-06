import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import {
  BODILY_INJURY_LIABILITY_REFUSAL,
  NOT_AVAILABLE_RESPONSE,
  OUTCOME_REASONS,
  REQUIRED_CLAIM_OUTPUT_FIELDS,
  REQUIRED_CLAIM_OUTPUT_LABELS,
  isNeverDisclosedField,
  validateCapturedField,
} from '@outbound-call/shared';
import type { CallMission } from '@outbound-call/shared';

// --- Zod schemas for tool arguments ---

export const getApprovedCaseFieldArgsSchema = z.object({
  missionId: z.string().uuid(),
  fieldKey: z.string(),
});

export const recordCollectedFieldArgsSchema = z.object({
  fieldKey: z.string(),
  value: z.string(),
  confirmationStatus: z.enum(['confirmed', 'tentative', 'unconfirmed']),
  representativeAttribution: z.string(),
  supportingQuote: z.string(),
});

export const recordMissingInformationArgsSchema = z.object({
  missingField: z.string(),
  reason: z.string(),
  effectOnCompletion: z.string(),
  suggestedNextStep: z.string(),
});

export const recordRequestedDocumentArgsSchema = z.object({
  documentName: z.string(),
  deliveryMethod: z.string(),
  destination: z.string(),
  deadline: z.string().nullable(),
});

export const recordEscalationArgsSchema = z.object({
  reason: z.string(),
  representativeRequest: z.string(),
  recommendedHumanAction: z.string(),
});

export const endCallArgsSchema = z.object({
  completionStatus: z.enum([
    'success',
    'partial_success',
    'failure',
    'human_follow_up',
  ]),
  outcomeReason: z.enum(OUTCOME_REASONS).optional(),
  closingReason: z.string(),
});

// --- In-memory provisional results store (per mission) ---

export interface ProvisionalResult {
  fieldKey: string;
  value: string;
  confirmationStatus: 'confirmed' | 'tentative' | 'unconfirmed';
  representativeAttribution: string;
  supportingQuote: string;
  recordedAt: string;
}

const provisionalResults = new Map<string, ProvisionalResult[]>();

export function getProvisionalResults(missionId: string): ProvisionalResult[] {
  return provisionalResults.get(missionId) ?? [];
}

export function clearProvisionalResults(missionId: string): void {
  provisionalResults.delete(missionId);
}

// --- Tool handlers ---

export interface ToolCallContext {
  missionId: string;
  callSessionId: string;
  mission: CallMission;
  onEndCall?: (
    status: 'success' | 'partial_success' | 'failure' | 'human_follow_up',
    reason: string
  ) => void;
}

async function saveCallEvent(
  missionId: string,
  callSessionId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('call_events').insert({
    id: uuidv4(),
    call_mission_id: missionId,
    call_session_id: callSessionId,
    source: 'system',
    event_type: eventType,
    event_payload: payload,
    occurred_at: new Date().toISOString(),
    processed_at: new Date().toISOString(),
    sequence_number: Date.now(),
  });

  if (error) {
    logger.error('Failed to save call event', {
      missionId,
      eventType,
      error,
    });
  }
}

export async function handleGetApprovedCaseField(
  rawArgs: unknown,
  ctx: ToolCallContext
): Promise<string> {
  const args = getApprovedCaseFieldArgsSchema.parse(rawArgs);

  logger.info('Tool: get_approved_case_field', {
    missionId: ctx.missionId,
    callSessionId: ctx.callSessionId,
    eventType: 'tool_call_requested',
  });

  if (isNeverDisclosedField(args.fieldKey)) {
    await saveCallEvent(ctx.missionId, ctx.callSessionId, 'tool_call_requested', {
      tool: 'get_approved_case_field',
      fieldKey: args.fieldKey,
      result: 'blocked_never_disclose',
    });
    return JSON.stringify({
      error: 'field_never_disclosed',
      message: `Never discuss this. Say exactly: "${BODILY_INJURY_LIABILITY_REFUSAL}"`,
    });
  }

  const field = ctx.mission.approvedContext.find(
    (c) => c.field === args.fieldKey && c.included
  );

  if (!field) {
    await saveCallEvent(ctx.missionId, ctx.callSessionId, 'tool_call_requested', {
      tool: 'get_approved_case_field',
      fieldKey: args.fieldKey,
      result: 'not_found',
    });
    return JSON.stringify({
      error: 'field_not_available',
      message: `The field "${args.fieldKey}" is not approved for this call. If the representative asked for it, say exactly: "${NOT_AVAILABLE_RESPONSE}" Do not answer from memory.`,
    });
  }

  await saveCallEvent(ctx.missionId, ctx.callSessionId, 'tool_call_requested', {
    tool: 'get_approved_case_field',
    fieldKey: args.fieldKey,
    result: 'found',
  });

  return JSON.stringify({
    fieldKey: field.field,
    label: field.label,
    value: field.missionSpecificValue ?? field.value,
  });
}

export async function handleRecordCollectedField(
  rawArgs: unknown,
  ctx: ToolCallContext
): Promise<string> {
  const args = recordCollectedFieldArgsSchema.parse(rawArgs);

  const validation = validateCapturedField(args.fieldKey, args.value);
  if (!validation.ok) {
    await saveCallEvent(ctx.missionId, ctx.callSessionId, 'tool_result_returned', {
      tool: 'record_collected_field',
      fieldKey: args.fieldKey,
      result: 'invalid',
      problem: validation.problem,
    });
    return JSON.stringify({
      status: 'invalid',
      fieldKey: args.fieldKey,
      problem: validation.problem,
      message:
        'Not recorded. Politely ask the representative to repeat just this one item, then record it again.',
    });
  }

  const entry: ProvisionalResult = {
    ...args,
    value: validation.value,
    recordedAt: new Date().toISOString(),
  };

  const existing = (provisionalResults.get(ctx.missionId) ?? []).filter(
    (r) => r.fieldKey !== args.fieldKey,
  );
  existing.push(entry);
  provisionalResults.set(ctx.missionId, existing);

  await saveCallEvent(ctx.missionId, ctx.callSessionId, 'tool_result_returned', {
    tool: 'record_collected_field',
    fieldKey: args.fieldKey,
    confirmationStatus: args.confirmationStatus,
  });

  logger.info('Tool: record_collected_field', {
    missionId: ctx.missionId,
    callSessionId: ctx.callSessionId,
    eventType: 'tool_result_returned',
  });

  return JSON.stringify({
    status: 'recorded',
    fieldKey: args.fieldKey,
    value: validation.value,
    message:
      args.confirmationStatus === 'confirmed'
        ? 'Confirmed value recorded.'
        : 'Recorded. Do not read it back now — include it in the single final confirmation.',
  });
}

export function missingRequiredOutputs(missionId: string): string[] {
  const recorded = new Set(getProvisionalResults(missionId).map((r) => r.fieldKey));
  return REQUIRED_CLAIM_OUTPUT_FIELDS.filter((f) => !recorded.has(f));
}

export async function handleCheckRequiredOutputs(
  _rawArgs: unknown,
  ctx: ToolCallContext
): Promise<string> {
  const missing = missingRequiredOutputs(ctx.missionId);
  const unconfirmed = getProvisionalResults(ctx.missionId)
    .filter(
      (r) =>
        (REQUIRED_CLAIM_OUTPUT_FIELDS as readonly string[]).includes(r.fieldKey) &&
        r.confirmationStatus !== 'confirmed',
    )
    .map((r) => r.fieldKey);

  return JSON.stringify({
    missing: missing.map((f) => ({
      fieldKey: f,
      label: REQUIRED_CLAIM_OUTPUT_LABELS[f as keyof typeof REQUIRED_CLAIM_OUTPUT_LABELS],
    })),
    awaitingFinalConfirmation: unconfirmed,
    message:
      missing.length > 0
        ? 'Ask for the missing items (once each). If unavailable, record them with record_missing_information.'
        : 'All required outputs recorded. Do the single final confirmation read-back.',
  });
}

export async function handleRecordMissingInformation(
  rawArgs: unknown,
  ctx: ToolCallContext
): Promise<string> {
  const args = recordMissingInformationArgsSchema.parse(rawArgs);

  await saveCallEvent(ctx.missionId, ctx.callSessionId, 'tool_result_returned', {
    tool: 'record_missing_information',
    ...args,
  });

  logger.info('Tool: record_missing_information', {
    missionId: ctx.missionId,
    callSessionId: ctx.callSessionId,
    eventType: 'tool_result_returned',
  });

  return JSON.stringify({
    status: 'recorded',
    missingField: args.missingField,
    message: 'Missing information has been recorded.',
  });
}

export async function handleRecordRequestedDocument(
  rawArgs: unknown,
  ctx: ToolCallContext
): Promise<string> {
  const args = recordRequestedDocumentArgsSchema.parse(rawArgs);

  await saveCallEvent(ctx.missionId, ctx.callSessionId, 'tool_result_returned', {
    tool: 'record_requested_document',
    ...args,
  });

  logger.info('Tool: record_requested_document', {
    missionId: ctx.missionId,
    callSessionId: ctx.callSessionId,
    eventType: 'tool_result_returned',
  });

  return JSON.stringify({
    status: 'recorded',
    documentName: args.documentName,
    message: 'Document request has been recorded.',
  });
}

export async function handleRecordEscalation(
  rawArgs: unknown,
  ctx: ToolCallContext
): Promise<string> {
  const args = recordEscalationArgsSchema.parse(rawArgs);

  await saveCallEvent(ctx.missionId, ctx.callSessionId, 'tool_result_returned', {
    tool: 'record_escalation',
    ...args,
  });

  await supabase
    .from('call_missions')
    .update({ outcome: 'human_follow_up' })
    .eq('id', ctx.missionId);

  logger.warn('Tool: record_escalation — mission flagged for human follow-up', {
    missionId: ctx.missionId,
    callSessionId: ctx.callSessionId,
    eventType: 'tool_result_returned',
  });

  return JSON.stringify({
    status: 'escalated',
    message:
      'Escalation recorded. Please politely end the call and let the representative know a human will follow up.',
  });
}

export async function handleEndCall(
  rawArgs: unknown,
  ctx: ToolCallContext
): Promise<string> {
  const args = endCallArgsSchema.parse(rawArgs);

  await saveCallEvent(ctx.missionId, ctx.callSessionId, 'call_completed', {
    tool: 'end_call',
    completionStatus: args.completionStatus,
    outcomeReason: args.outcomeReason ?? null,
    closingReason: args.closingReason,
  });

  logger.info('Tool: end_call', {
    missionId: ctx.missionId,
    callSessionId: ctx.callSessionId,
    status: args.completionStatus,
    eventType: 'call_completed',
  });

  ctx.onEndCall?.(args.completionStatus, args.closingReason);

  return JSON.stringify({
    status: 'call_ending',
    completionStatus: args.completionStatus,
    message: 'Call termination initiated.',
  });
}

export async function handlePressKeys(
  rawArgs: unknown,
  ctx: ToolCallContext
): Promise<string> {
  const raw = (rawArgs ?? {}) as { digits?: unknown; reason?: unknown };
  const digits = String(raw.digits ?? '').replace(/[\s,-]/g, '');
  // Lazy: keypad.ts loads config/Twilio, which this module otherwise doesn't need.
  const { pressKeys } = await import('./keypad.js');
  const result = await pressKeys(ctx.callSessionId, digits);

  await saveCallEvent(ctx.missionId, ctx.callSessionId, 'dtmf_sent', {
    tool: 'press_keys',
    digits,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    ok: result.ok,
    error: result.ok ? null : result.reason,
  });

  logger.info('Tool: press_keys', {
    missionId: ctx.missionId,
    callSessionId: ctx.callSessionId,
    ok: result.ok,
    eventType: 'dtmf_sent',
  });

  if (result.ok) {
    return JSON.stringify({
      status: 'keys_pressed',
      digits,
      message: 'The keys were pressed. Do not speak; stay silent and listen for the next prompt.',
    });
  }
  if (result.reason === 'invalid_digits') {
    return JSON.stringify({ error: 'invalid_digits', message: 'Use only 0-9, * and # (up to 32 keys).' });
  }
  return JSON.stringify({
    error: result.reason,
    message: 'Keypad is not available on this call. Say the option out loud instead, or say "representative".',
  });
}

// --- Tool dispatch ---

export async function dispatchToolCall(
  name: string,
  rawArgs: unknown,
  ctx: ToolCallContext
): Promise<string> {
  switch (name) {
    case 'get_approved_case_field':
      return handleGetApprovedCaseField(rawArgs, ctx);
    case 'record_collected_field':
      return handleRecordCollectedField(rawArgs, ctx);
    case 'check_required_outputs':
      return handleCheckRequiredOutputs(rawArgs, ctx);
    case 'record_missing_information':
      return handleRecordMissingInformation(rawArgs, ctx);
    case 'record_requested_document':
      return handleRecordRequestedDocument(rawArgs, ctx);
    case 'record_escalation':
      return handleRecordEscalation(rawArgs, ctx);
    case 'end_call':
      return handleEndCall(rawArgs, ctx);
    case 'press_keys':
      return handlePressKeys(rawArgs, ctx);
    default:
      logger.warn(`Unknown tool call: ${name}`, { missionId: ctx.missionId });
      return JSON.stringify({ error: 'unknown_tool', message: `Tool "${name}" is not defined.` });
  }
}

// --- xAI-compatible tool definitions ---

const PRESS_KEYS_TOOL = {
  type: 'function' as const,
  name: 'press_keys',
  description:
    'Press keys on the phone keypad (DTMF) in an automated phone menu. Use this whenever a menu says "press N" or asks you to enter a number with the keypad. Do not say the digits out loud.',
  parameters: {
    type: 'object',
    properties: {
      digits: {
        type: 'string',
        description: 'Keys to press: 0-9, * and #. Use "w" for a half-second pause between keys (e.g. "1w2").',
      },
      reason: {
        type: 'string',
        description: 'Which menu option this selects (e.g. "claims department").',
      },
    },
    required: ['digits'],
  },
};

export function getToolDefinitions(opts: { keypad?: boolean } = {}): Array<{
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  return [
    ...(opts.keypad ? [PRESS_KEYS_TOOL] : []),
    {
      type: 'function',
      name: 'get_approved_case_field',
      description:
        'Retrieve a specific approved case field value. Use this to look up client or case information before disclosing it. Only fields that have been approved for this mission will be returned.',
      parameters: {
        type: 'object',
        properties: {
          missionId: {
            type: 'string',
            description: 'The UUID of the current call mission.',
          },
          fieldKey: {
            type: 'string',
            description:
              'The field key to look up (e.g. "client_full_name", "policy_number", "date_of_loss").',
          },
        },
        required: ['missionId', 'fieldKey'],
      },
    },
    {
      type: 'function',
      name: 'record_collected_field',
      description:
        'Record a piece of information collected from the insurance representative during the call. This saves the value for post-call review — it does NOT update the case directly.',
      parameters: {
        type: 'object',
        properties: {
          fieldKey: {
            type: 'string',
            description:
              'Use these keys for required outputs: "claim_number", "adjuster_name", "adjuster_phone", "adjuster_fax", "adjuster_email", "adjuster_mailing_address". Other keys: "representative_name", "representative_department".',
          },
          value: {
            type: 'string',
            description:
              'The value collected. Phone/fax: all 10 digits plus any extension. Email: name@domain.com form.',
          },
          confirmationStatus: {
            type: 'string',
            enum: ['confirmed', 'tentative', 'unconfirmed'],
            description:
              '"tentative" when first heard. "confirmed" only after the representative confirms it in the single final read-back. "unconfirmed" = inferred or unclear.',
          },
          representativeAttribution: {
            type: 'string',
            description:
              'Who provided this information (e.g. "Claims representative Sarah").',
          },
          supportingQuote: {
            type: 'string',
            description:
              'A brief quote or paraphrase from the conversation that supports this value.',
          },
        },
        required: [
          'fieldKey',
          'value',
          'confirmationStatus',
          'representativeAttribution',
          'supportingQuote',
        ],
      },
    },
    {
      type: 'function',
      name: 'check_required_outputs',
      description:
        'Check which Letter of Representation outputs (claim number, adjuster name/phone/fax/email/mailing address) are still missing or not yet confirmed. Call before the final read-back and before ending the call.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      type: 'function',
      name: 'record_missing_information',
      description:
        'Record that a required piece of information could not be obtained during the call.',
      parameters: {
        type: 'object',
        properties: {
          missingField: {
            type: 'string',
            description: 'The field that could not be obtained.',
          },
          reason: {
            type: 'string',
            description: 'Why the information was unavailable.',
          },
          effectOnCompletion: {
            type: 'string',
            description:
              'How this missing information affects mission completion.',
          },
          suggestedNextStep: {
            type: 'string',
            description: 'What should happen next to obtain this information.',
          },
        },
        required: [
          'missingField',
          'reason',
          'effectOnCompletion',
          'suggestedNextStep',
        ],
      },
    },
    {
      type: 'function',
      name: 'record_requested_document',
      description:
        'Record that the insurance representative requested a document be sent.',
      parameters: {
        type: 'object',
        properties: {
          documentName: {
            type: 'string',
            description:
              'The name or type of document requested (e.g. "Letter of Representation", "Police Report").',
          },
          deliveryMethod: {
            type: 'string',
            description: 'How the document should be delivered (e.g. "fax", "email", "mail").',
          },
          destination: {
            type: 'string',
            description: 'Where to send the document (fax number, email, mailing address).',
          },
          deadline: {
            type: ['string', 'null'],
            description: 'When the document is due, if specified. Null if no deadline given.',
          },
        },
        required: ['documentName', 'deliveryMethod', 'destination', 'deadline'],
      },
    },
    {
      type: 'function',
      name: 'record_escalation',
      description:
        'Record an escalation event. Use this when the conversation requires human attorney intervention. After calling this, politely end the call.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Why escalation is needed.',
          },
          representativeRequest: {
            type: 'string',
            description: 'What the representative asked for or said that triggered escalation.',
          },
          recommendedHumanAction: {
            type: 'string',
            description: 'What the human attorney should do when following up.',
          },
        },
        required: ['reason', 'representativeRequest', 'recommendedHumanAction'],
      },
    },
    {
      type: 'function',
      name: 'end_call',
      description:
        'End the current call. Call this after you have summarized the call, confirmed next steps, and thanked the representative.',
      parameters: {
        type: 'object',
        properties: {
          completionStatus: {
            type: 'string',
            enum: ['success', 'partial_success', 'failure', 'human_follow_up'],
            description: 'The overall outcome of the call.',
          },
          outcomeReason: {
            type: 'string',
            enum: [...OUTCOME_REASONS],
            description:
              'Why the call ended this way: completed, ai_declined_restricted_request, carrier_refused_ai, unable_to_reach_representative, missing_required_information, human_follow_up_required.',
          },
          closingReason: {
            type: 'string',
            description: 'A brief explanation of why the call is ending with this status.',
          },
        },
        required: ['completionStatus', 'outcomeReason', 'closingReason'],
      },
    },
  ];
}
