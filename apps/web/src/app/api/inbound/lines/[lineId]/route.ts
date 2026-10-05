import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, writeInboundAudit } from '@/lib/inbound-admin';
import { clearOtherDefaults, validateLineMeta } from '@/lib/inbound-lines';

/** Update a line's name, numbers, Sign Flow account, default and active flags. */
export async function PATCH(request: NextRequest, { params }: { params: { lineId: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;

  const { data: before } = await supabase
    .from('inbound_lines')
    .select('name, slug, phone_numbers, signflow_firm_id, is_default, active')
    .eq('id', params.lineId)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'Line not found' }, { status: 404 });

  const v = await validateLineMeta(supabase, (await request.json()).line, params.lineId);
  if (!v.ok) return v.response;
  const meta = v.meta;
  if (before.is_default && !meta.is_default) {
    return NextResponse.json({ error: 'Make another line the default first' }, { status: 400 });
  }
  if (meta.is_default && !meta.active) {
    return NextResponse.json({ error: 'The default line must be active' }, { status: 400 });
  }

  if (meta.is_default && !before.is_default) {
    const err = await clearOtherDefaults(supabase, params.lineId);
    if (err) return NextResponse.json({ error: `Failed to save: ${err}` }, { status: 500 });
  }
  const { error } = await supabase
    .from('inbound_lines')
    .update({ ...meta, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', params.lineId);
  if (error) return NextResponse.json({ error: `Failed to save: ${error.message}` }, { status: 500 });

  await writeInboundAudit(supabase, {
    type: 'SETTINGS_CHANGED',
    actor: 'ADMIN',
    userId,
    data: { section: 'line', line_id: params.lineId, by: email, before, after: meta },
  });
  return NextResponse.json({ ok: true, line: meta });
}

/** Delete a non-default line. Its calls and intakes stay (they lose the line link); its instructions are removed. */
export async function DELETE(_request: NextRequest, { params }: { params: { lineId: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;

  const { data: line } = await supabase.from('inbound_lines').select('name, is_default').eq('id', params.lineId).maybeSingle();
  if (!line) return NextResponse.json({ error: 'Line not found' }, { status: 404 });
  if (line.is_default) return NextResponse.json({ error: 'The default line cannot be deleted' }, { status: 400 });

  const { error } = await supabase.from('inbound_lines').delete().eq('id', params.lineId);
  if (error) return NextResponse.json({ error: `Failed to delete: ${error.message}` }, { status: 500 });

  await writeInboundAudit(supabase, {
    type: 'SETTINGS_CHANGED',
    actor: 'ADMIN',
    userId,
    data: { section: 'line_deleted', line_id: params.lineId, name: line.name, by: email },
  });
  return NextResponse.json({ ok: true });
}
