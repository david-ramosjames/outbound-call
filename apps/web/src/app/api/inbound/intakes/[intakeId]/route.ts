import { NextRequest, NextResponse } from 'next/server';
import { INBOUND_INTAKE_STATUSES } from '@outbound-call/shared';
import { requireAdmin, writeInboundAudit } from '@/lib/inbound-admin';

/** Staff review of an intake: change status, add notes, mark reviewed. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await params;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;

  const body = (await request.json()) as { status?: string; staff_notes?: string; reviewed?: boolean };
  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!(INBOUND_INTAKE_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.staff_notes !== undefined) patch.staff_notes = body.staff_notes.slice(0, 5000);
  if (body.reviewed) {
    patch.reviewed_by = userId;
    patch.reviewed_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  const { data: intake, error } = await supabase
    .from('inbound_intakes')
    .update(patch)
    .eq('id', intakeId)
    .select('id, call_id')
    .maybeSingle();
  if (error || !intake) return NextResponse.json({ error: error?.message ?? 'Intake not found' }, { status: 404 });

  await writeInboundAudit(supabase, {
    type: body.status === 'needs_review' ? 'NEEDS_REVIEW_MARKED' : 'INTAKE_UPDATED',
    actor: 'HUMAN',
    userId,
    intakeId: intake.id as string,
    callId: (intake.call_id as string | null) ?? null,
    data: { by: email, ...patch, staff_notes: body.staff_notes !== undefined ? '(updated)' : undefined },
  });
  return NextResponse.json({ ok: true });
}
