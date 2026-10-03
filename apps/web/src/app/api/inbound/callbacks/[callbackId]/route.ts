import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, writeInboundAudit } from '@/lib/inbound-admin';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ callbackId: string }> }) {
  const { callbackId } = await params;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;

  const { status } = (await request.json()) as { status?: 'open' | 'done' };
  if (status !== 'open' && status !== 'done') return NextResponse.json({ error: 'status must be open or done' }, { status: 400 });

  const { data, error } = await supabase
    .from('inbound_callback_requests')
    .update({
      status,
      completed_by: status === 'done' ? userId : null,
      completed_at: status === 'done' ? new Date().toISOString() : null,
    })
    .eq('id', callbackId)
    .select('id, intake_id, call_id')
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 });

  await writeInboundAudit(supabase, {
    type: 'INTAKE_UPDATED',
    actor: 'HUMAN',
    userId,
    intakeId: data.intake_id as string | null,
    callId: data.call_id as string | null,
    data: { callback: data.id, status, by: email },
  });
  return NextResponse.json({ ok: true });
}
