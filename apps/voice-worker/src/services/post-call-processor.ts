import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import {
  getProvisionalResults,
  clearProvisionalResults,
  type ProvisionalResult,
} from './grok-tools.js';
import {
  MISSION_OUTCOME_FOR_REASON,
  REQUIRED_CLAIM_OUTPUT_FIELDS,
  REQUIRED_CLAIM_OUTPUT_LABELS,
  isOutcomeReason,
  resolveOutcomeReason,
  validateCapturedField,
} from '@outbound-call/shared';
import type { MissionOutcome, OutcomeReason } from '@outbound-call/shared';
import { config } from '../config.js';
import { summarizeTranscript } from './transcript-summarizer.js';

const FIELD_LABELS: Record<string, string> = {
  claim_number: 'Claim Number',
  adjuster_name: 'Adjuster Name',
  adjuster_phone: 'Adjuster Phone',
  adjuster_fax: 'Adjuster Fax',
  adjuster_email: 'Adjuster Email',
  adjuster_mailing_address: 'Adjuster Mailing Address',
  carrier_fax: 'Carrier Fax',
  carrier_mailing_address: 'Carrier Mailing Address',
  representative_name: 'Representative Name',
  representative_department: 'Representative Department',
};

const PROPOSABLE_FIELDS = [...REQUIRED_CLAIM_OUTPUT_FIELDS];

function confidenceFromStatus(
  status: ProvisionalResult['confirmationStatus']
): number {
  switch (status) {
    case 'confirmed':
      return 1.0;
    case 'tentative':
      return 0.7;
    case 'unconfirmed':
      return 0.4;
  }
}

export async function processCallResults(missionId: string): Promise<void> {
  const logCtx = { missionId };
  logger.info('Starting post-call processing', logCtx);

  // Collect provisional results
  const results = [...getProvisionalResults(missionId)];

  const transcriptSummary =
    config.VOICE_MODE === 'live' ? await summarizeTranscript(missionId) : null;

  if (transcriptSummary) {
    const recordedKeys = new Set(results.map((r) => r.fieldKey));
    for (const [fieldKey, value] of Object.entries(
      transcriptSummary.extractedFields
    )) {
      if (!value || recordedKeys.has(fieldKey)) continue;
      const validation = validateCapturedField(fieldKey, value);
      if (!validation.ok) continue;
      results.push({
        fieldKey,
        value: validation.value,
        confirmationStatus: 'unconfirmed',
        representativeAttribution: 'extracted from transcript',
        supportingQuote: '',
        recordedAt: new Date().toISOString(),
      });
    }
  }

  // Gather tool call events for missing info, documents, escalations
  const { data: events } = await supabase
    .from('call_events')
    .select('*')
    .eq('call_mission_id', missionId)
    .in('event_type', ['tool_result_returned', 'call_completed'])
    .order('occurred_at', { ascending: true });

  const missingInfo: Array<{
    field: string;
    reason: string;
    effect: string | null;
    suggestedNextStep: string | null;
  }> = [];
  const requestedDocs: Array<{
    documentName: string;
    deliveryMethod: string | null;
    destination: string | null;
    deadline: string | null;
  }> = [];
  let escalationReason: string | null = null;
  let completionStatus = 'not_reported';
  let reportedOutcomeReason: OutcomeReason | null = null;

  for (const ev of events ?? []) {
    const payload = ev.event_payload as Record<string, unknown> | null;
    if (!payload) continue;

    const tool = payload.tool as string | undefined;

    if (tool === 'record_missing_information') {
      missingInfo.push({
        field: payload.missingField as string,
        reason: payload.reason as string,
        effect: (payload.effectOnCompletion as string) ?? null,
        suggestedNextStep: (payload.suggestedNextStep as string) ?? null,
      });
    }

    if (tool === 'record_requested_document') {
      requestedDocs.push({
        documentName: payload.documentName as string,
        deliveryMethod: (payload.deliveryMethod as string) ?? null,
        destination: (payload.destination as string) ?? null,
        deadline: (payload.deadline as string) ?? null,
      });
    }

    if (tool === 'record_escalation') {
      escalationReason = payload.reason as string;
    }

    if (tool === 'end_call') {
      completionStatus = payload.completionStatus as string;
      if (isOutcomeReason(payload.outcomeReason)) {
        reportedOutcomeReason = payload.outcomeReason;
      }
    }
  }

  // Build structured result
  const resultMap = new Map<string, ProvisionalResult>();
  for (const r of results) {
    resultMap.set(r.fieldKey, r);
  }

  const get = (key: string) => resultMap.get(key)?.value ?? null;
  const hasClaim = get('claim_number') !== null;

  const missingRequired = REQUIRED_CLAIM_OUTPUT_FIELDS.filter((f) => !resultMap.has(f));
  const alreadyNoted = new Set(missingInfo.map((m) => m.field));
  for (const field of hasClaim ? missingRequired : (['claim_number'] as const)) {
    if (alreadyNoted.has(field)) continue;
    missingInfo.push({
      field,
      reason: `${REQUIRED_CLAIM_OUTPUT_LABELS[field]} was not obtained on the call.`,
      effect: 'Needed for the Letter of Representation.',
      suggestedNextStep: hasClaim
        ? `Call back on claim ${get('claim_number')} to get the ${REQUIRED_CLAIM_OUTPUT_LABELS[field].toLowerCase()}.`
        : 'Follow up to open or locate the claim.',
    });
  }

  const { count: carrierSegmentCount } = await supabase
    .from('call_transcript_segments')
    .select('id', { count: 'exact', head: true })
    .eq('call_mission_id', missionId)
    .eq('speaker', 'insurance_representative');

  const outcomeReason = resolveOutcomeReason({
    reported: reportedOutcomeReason ?? transcriptSummary?.outcomeReason ?? null,
    escalated: escalationReason !== null,
    reachedHuman: (carrierSegmentCount ?? 0) > 0 || results.length > 0,
    hasClaim,
    missingRequiredCount: missingRequired.length,
  });

  const missionOutcome = determineMissionOutcome(
    completionStatus,
    escalationReason,
    outcomeReason
  );

  const structuredResults = {
    missionOutcome,
    outcomeReason,
    claimOpened: hasClaim,
    existingClaimLocated: false,
    claimNumber: get('claim_number'),
    representativeName: get('representative_name'),
    representativeDepartment: get('representative_department'),
    adjusterName: get('adjuster_name'),
    adjusterPhone: get('adjuster_phone'),
    adjusterFax: get('adjuster_fax'),
    adjusterEmail: get('adjuster_email'),
    adjusterMailingAddress: get('adjuster_mailing_address'),
    carrierFax: get('carrier_fax'),
    carrierMailingAddress: get('carrier_mailing_address'),
    missingRequiredOutputs: hasClaim ? missingRequired : ['claim_number'],
    requestedDocuments: requestedDocs,
    missingInformation: missingInfo,
    commitments: transcriptSummary?.commitments ?? [],
    deadlines: [] as Array<{ description: string; date: string | null }>,
    nextAction: missingInfo.length > 0
      ? missingInfo[0]!.suggestedNextStep
      : transcriptSummary?.nextAction ?? null,
    suggestedFollowUpDate: null as string | null,
    escalationReason,
    summary: transcriptSummary
      ? `${buildSummary(missionOutcome, results, missingInfo)}\n\n${transcriptSummary.summary}`
      : buildSummary(missionOutcome, results, missingInfo),
    confidence: buildConfidenceMap(results),
    evidence: buildEvidenceMap(results),
  };

  // Create call_results record
  const callResultId = uuidv4();
  const { error: resultError } = await supabase.from('call_results').insert({
    id: callResultId,
    call_mission_id: missionId,
    mission_outcome: missionOutcome,
    completion_status: completionStatus,
    summary: structuredResults.summary,
    structured_results: structuredResults,
    requested_documents: requestedDocs,
    missing_information: missingInfo,
    commitments: structuredResults.commitments,
    deadlines: structuredResults.deadlines,
    next_action: structuredResults.nextAction,
    suggested_follow_up_date: structuredResults.suggestedFollowUpDate,
    escalation_reason: escalationReason,
  });

  if (resultError) {
    logger.error('Failed to create call_results', {
      ...logCtx,
      error: resultError,
    });
    return;
  }

  // Create call_result_fields
  for (const r of results) {
    await supabase.from('call_result_fields').insert({
      id: uuidv4(),
      call_result_id: callResultId,
      field_key: r.fieldKey,
      field_label: FIELD_LABELS[r.fieldKey] ?? r.fieldKey,
      extracted_value: r.value,
      confidence: confidenceFromStatus(r.confirmationStatus),
      evidence_segment_ids: [],
      review_status: 'pending',
    });
  }

  // Create call_proposed_updates for key case fields
  const { data: mission } = await supabase
    .from('call_missions')
    .select('case_id')
    .eq('id', missionId)
    .single();

  if (mission) {
    for (const fieldKey of PROPOSABLE_FIELDS) {
      const provisional = resultMap.get(fieldKey);
      if (!provisional) continue;

      await supabase.from('call_proposed_updates').insert({
        id: uuidv4(),
        call_mission_id: missionId,
        target_type: 'case',
        target_id: mission.case_id,
        target_field: fieldKey,
        current_value: null,
        proposed_value: provisional.value,
        reason: `Collected during call. Attribution: ${provisional.representativeAttribution}. Status: ${provisional.confirmationStatus}.`,
        review_status: 'pending',
      });
    }
  }

  // Update mission status to awaiting_review
  await supabase
    .from('call_missions')
    .update({
      status: 'awaiting_review',
      outcome: missionOutcome,
    })
    .eq('id', missionId);

  // Separate write so a database without the outcome_reason column still gets the status update.
  const { error: reasonError } = await supabase
    .from('call_missions')
    .update({ outcome_reason: outcomeReason })
    .eq('id', missionId);
  if (reasonError) {
    logger.error('Failed to save outcome_reason (run migration 20240101000007?)', {
      ...logCtx,
      errorMessage: reasonError.message,
    });
  }

  // Clean up provisional results
  clearProvisionalResults(missionId);

  logger.info('Post-call processing completed', {
    ...logCtx,
    status: missionOutcome,
    outcomeReason,
  });
}

function determineMissionOutcome(
  completionStatus: string,
  escalationReason: string | null,
  outcomeReason: OutcomeReason
): MissionOutcome {
  if (escalationReason) return 'human_follow_up';

  if (
    completionStatus === 'success' ||
    completionStatus === 'partial_success' ||
    completionStatus === 'failure' ||
    completionStatus === 'human_follow_up'
  ) {
    if (completionStatus === 'success' && outcomeReason === 'missing_required_information') {
      return 'partial_success';
    }
    return completionStatus as MissionOutcome;
  }

  return MISSION_OUTCOME_FOR_REASON[outcomeReason];
}

function buildSummary(
  outcome: MissionOutcome,
  results: ProvisionalResult[],
  missingInfo: Array<{ field: string; reason: string }>
): string {
  const parts: string[] = [];

  switch (outcome) {
    case 'success':
      parts.push('Call completed successfully.');
      break;
    case 'partial_success':
      parts.push('Call partially completed.');
      break;
    case 'failure':
      parts.push('Call did not achieve its objectives.');
      break;
    case 'human_follow_up':
      parts.push('Call requires human follow-up.');
      break;
  }

  if (results.length > 0) {
    parts.push(`${results.length} field(s) collected.`);
  }

  if (missingInfo.length > 0) {
    parts.push(`${missingInfo.length} field(s) could not be obtained.`);
  }

  return parts.join(' ');
}

function buildConfidenceMap(
  results: ProvisionalResult[]
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const r of results) {
    map[r.fieldKey] = confidenceFromStatus(r.confirmationStatus);
  }
  return map;
}

function buildEvidenceMap(
  results: ProvisionalResult[]
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const r of results) {
    if (r.supportingQuote) {
      map[r.fieldKey] = [r.supportingQuote];
    }
  }
  return map;
}
