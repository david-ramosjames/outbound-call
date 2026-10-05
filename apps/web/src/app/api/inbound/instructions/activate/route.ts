import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, writeInboundAudit } from '@/lib/inbound-admin';

/** Roll back / forward to an existing instructions version of a line. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;

  const { version, lineId } = (await request.json()) as { version?: number; lineId?: string | null };
  if (!Number.isInteger(version)) return NextResponse.json({ error: 'version is required' }, { status: 400 });

  let find = supabase.from('inbound_agent_instructions').select('id').eq('version', version!);
  if (lineId) find = find.eq('line_id', lineId);
  const { data: target } = await find.maybeSingle();
  if (!target) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

  let deactivate = supabase.from('inbound_agent_instructions').update({ is_active: false }).eq('is_active', true);
  if (lineId) deactivate = deactivate.eq('line_id', lineId);
  await deactivate;
  const { error } = await supabase.from('inbound_agent_instructions').update({ is_active: true }).eq('id', target.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeInboundAudit(supabase, {
    type: 'INSTRUCTIONS_CHANGED',
    actor: 'ADMIN',
    userId,
    data: { activated_version: version, line_id: lineId ?? null, by: email },
  });
  return NextResponse.json({ ok: true });
}
