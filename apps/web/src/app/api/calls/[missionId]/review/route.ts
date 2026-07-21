import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canReviewCalls } from '@/lib/permissions';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
) {
  const { missionId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permitted = await canReviewCalls(user.id);
  if (!permitted) {
    return NextResponse.json(
      { error: 'You do not have permission to review calls' },
      { status: 403 },
    );
  }

  const body = await request.json();
  const { action } = body as { action?: string };

  if (action === 'complete_review') {
    const { data: mission } = await supabase
      .from('call_missions')
      .select('id, status')
      .eq('id', missionId)
      .single();

    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    if (mission.status !== 'awaiting_review' && mission.status !== 'completed') {
      return NextResponse.json(
        { error: `Cannot complete review from status "${mission.status}"` },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from('call_missions')
      .update({
        status: 'reviewed',
      })
      .eq('id', missionId);

    if (error) {
      console.error('[review] complete_review failed', error);
      return NextResponse.json(
        { error: error.message || 'Failed to complete review' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, status: 'reviewed' });
  }

  const { fieldId, reviewStatus, reviewedValue } = body;

  if (!fieldId || !reviewStatus) {
    return NextResponse.json(
      { error: 'fieldId and reviewStatus are required' },
      { status: 400 },
    );
  }

  const validStatuses = ['accepted', 'edited', 'rejected'];
  if (!validStatuses.includes(reviewStatus)) {
    return NextResponse.json(
      { error: 'Invalid review status' },
      { status: 400 },
    );
  }

  const { data: field } = await supabase
    .from('call_result_fields')
    .select('id, call_result_id')
    .eq('id', fieldId)
    .single();

  if (!field) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }

  const { data: result } = await supabase
    .from('call_results')
    .select('call_mission_id')
    .eq('id', field.call_result_id)
    .single();

  if (!result || result.call_mission_id !== missionId) {
    return NextResponse.json(
      { error: 'Field does not belong to this mission' },
      { status: 400 },
    );
  }

  const updateData: Record<string, unknown> = {
    review_status: reviewStatus,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  };

  if (reviewStatus === 'edited' && reviewedValue !== undefined) {
    updateData.reviewed_value = reviewedValue;
  }

  const { error: updateError } = await supabase
    .from('call_result_fields')
    .update(updateData)
    .eq('id', fieldId);

  if (updateError) {
    return NextResponse.json(
      { error: 'Failed to update field' },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
