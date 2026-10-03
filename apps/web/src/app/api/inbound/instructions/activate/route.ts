import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, writeInboundAudit } from '@/lib/inbound-admin';

/** Roll back / forward to an existing instructions version. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;

  const { version } = (await request.json()) as { version?: number };
  if (!Number.isInteger(version)) return NextResponse.json({ error: 'version is required' }, { status: 400 });

  const { data: target } = await supabase.from('inbound_agent_instructions').select('id').eq('version', version!).maybeSingle();
  if (!target) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

  await supabase.from('inbound_agent_instructions').update({ is_active: false }).eq('is_active', true);
  const { error } = await supabase.from('inbound_agent_instructions').update({ is_active: true }).eq('id', target.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeInboundAudit(supabase, {
    type: 'INSTRUCTIONS_CHANGED',
    actor: 'ADMIN',
    userId,
    data: { activated_version: version, by: email },
  });
  return NextResponse.json({ ok: true });
}
