import { createClient } from '@/lib/supabase/server';
import {
  APPROVED_CONTEXT_FIELDS,
  CONTEXT_FIELD_LABELS,
} from '@outbound-call/shared';
import type { ApprovedContextEntry } from '@outbound-call/shared';

export interface CaseDataAdapter {
  getSuggestedCallContext(caseId: string, userId: string): Promise<ApprovedContextEntry[]>;
  getApprovedFieldSnapshot(
    caseId: string,
    selectedFields: ApprovedContextEntry[],
    userId: string,
  ): Promise<Record<string, unknown>>;
  createProposedUpdates(
    missionId: string,
    results: Array<{ field: string; value: unknown; reason: string }>,
  ): Promise<void>;
  applyApprovedUpdate(updateId: string, reviewerId: string): Promise<boolean>;
  createCaseNote(caseId: string, note: string, reviewerId: string): Promise<void>;
  createFollowUpTask(caseId: string, task: string, reviewerId: string): Promise<void>;
}

export class SupabaseCaseDataAdapter implements CaseDataAdapter {
  async getSuggestedCallContext(caseId: string, _userId: string): Promise<ApprovedContextEntry[]> {
    const supabase = await createClient();

    const { data: caseData } = await supabase
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .single();

    const clientFullName =
      caseData?.client_name ||
      [caseData?.client_first_name, caseData?.client_last_name]
        .filter(Boolean)
        .join(' ');

    const mapped: Record<string, string | undefined> = {
      client_full_name: clientFullName || undefined,
      client_date_of_birth: caseData?.date_of_birth || undefined,
      client_phone_number: caseData?.client_phone || undefined,
      date_of_loss: caseData?.date_of_incident || undefined,
      case_type: caseData?.case_type || undefined,
      law_firm_name: 'Ramos James Law',
    };

    return APPROVED_CONTEXT_FIELDS.map((field) => ({
      field,
      label: CONTEXT_FIELD_LABELS[field],
      value: mapped[field] ?? (caseData?.[field] ? String(caseData[field]) : ''),
      included: false,
    }));
  }

  async getApprovedFieldSnapshot(
    caseId: string,
    selectedFields: ApprovedContextEntry[],
    _userId: string,
  ): Promise<Record<string, unknown>> {
    const snapshot: Record<string, unknown> = {
      caseId,
      createdAt: new Date().toISOString(),
      fields: selectedFields.filter((f) => f.included).map((f) => ({
        field: f.field,
        label: f.label,
        value: f.missionSpecificValue || f.value,
      })),
    };

    return snapshot;
  }

  async createProposedUpdates(
    missionId: string,
    results: Array<{ field: string; value: unknown; reason: string }>,
  ): Promise<void> {
    const supabase = await createClient();

    const { data: mission } = await supabase
      .from('call_missions')
      .select('case_id')
      .eq('id', missionId)
      .single();

    if (!mission) return;

    const { data: caseData } = await supabase
      .from('cases')
      .select('*')
      .eq('id', mission.case_id)
      .single();

    const updates = results.map((r) => ({
      call_mission_id: missionId,
      target_type: 'case',
      target_id: mission.case_id,
      target_field: r.field,
      current_value: caseData?.[r.field] ?? null,
      proposed_value: r.value,
      reason: r.reason,
      review_status: 'pending' as const,
    }));

    if (updates.length > 0) {
      await supabase.from('call_proposed_updates').insert(updates);
    }
  }

  async applyApprovedUpdate(updateId: string, reviewerId: string): Promise<boolean> {
    const supabase = await createClient();

    const { data: update } = await supabase
      .from('call_proposed_updates')
      .select('*')
      .eq('id', updateId)
      .single();

    if (!update) return false;
    if (update.review_status !== 'accepted' && update.review_status !== 'edited') {
      return false;
    }

    const valueToApply = update.review_status === 'edited'
      ? update.reviewed_value
      : update.proposed_value;

    if (update.target_type === 'case') {
      const { error } = await supabase
        .from('cases')
        .update({ [update.target_field]: valueToApply })
        .eq('id', update.target_id);

      if (error) return false;
    }

    await supabase
      .from('call_proposed_updates')
      .update({ applied_at: new Date().toISOString() })
      .eq('id', updateId);

    return true;
  }

  async createCaseNote(caseId: string, note: string, reviewerId: string): Promise<void> {
    const supabase = await createClient();

    await supabase.from('case_events').insert({
      case_id: caseId,
      event_type: 'note',
      description: note,
      created_by: reviewerId,
    });
  }

  async createFollowUpTask(caseId: string, task: string, reviewerId: string): Promise<void> {
    const supabase = await createClient();

    await supabase.from('case_events').insert({
      case_id: caseId,
      event_type: 'task',
      description: task,
      created_by: reviewerId,
    });
  }
}
