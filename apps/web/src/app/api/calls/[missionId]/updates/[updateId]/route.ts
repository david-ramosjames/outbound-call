import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canReviewCalls } from '@/lib/permissions';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string; updateId: string }> },
) {
  const { missionId, updateId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permitted = await canReviewCalls(user.id);
  if (!permitted) {
    return NextResponse.json(
      { error: 'You do not have permission to review updates' },
      { status: 403 },
    );
  }

  const body = await request.json();
  const { reviewStatus, reviewedValue } = body;

  if (!reviewStatus) {
    return NextResponse.json(
      { error: 'reviewStatus is required' },
      { status: 400 },
    );
  }

  const { data: update } = await supabase
    .from('call_proposed_updates')
    .select('*')
    .eq('id', updateId)
    .eq('call_mission_id', missionId)
    .single();

  if (!update) {
    return NextResponse.json({ error: 'Update not found' }, { status: 404 });
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
    .from('call_proposed_updates')
    .update(updateData)
    .eq('id', updateId);

  if (updateError) {
    return NextResponse.json(
      { error: 'Failed to update' },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string; updateId: string }> },
) {
  const { missionId, updateId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permitted = await canReviewCalls(user.id);
  if (!permitted) {
    return NextResponse.json(
      { error: 'You do not have permission to apply updates' },
      { status: 403 },
    );
  }

  const body = await request.json();
  if (body.action !== 'apply') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const { data: update } = await supabase
    .from('call_proposed_updates')
    .select('*')
    .eq('id', updateId)
    .eq('call_mission_id', missionId)
    .single();

  if (!update) {
    return NextResponse.json({ error: 'Update not found' }, { status: 404 });
  }

  if (update.review_status !== 'accepted' && update.review_status !== 'edited') {
    return NextResponse.json(
      { error: 'Update must be accepted or edited before applying' },
      { status: 400 },
    );
  }

  const valueToApply = update.review_status === 'edited'
    ? update.reviewed_value
    : update.proposed_value;

  if (update.target_type === 'case') {
    const { error: caseError } = await supabase
      .from('cases')
      .update({ [update.target_field]: valueToApply })
      .eq('id', update.target_id);

    if (caseError) {
      return NextResponse.json(
        { error: 'Failed to apply update to case' },
        { status: 500 },
      );
    }
  }

  await supabase
    .from('call_proposed_updates')
    .update({ applied_at: new Date().toISOString() })
    .eq('id', updateId);

  return NextResponse.json({ success: true, applied: true });
}
