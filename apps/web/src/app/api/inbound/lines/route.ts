import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, writeInboundAudit } from '@/lib/inbound-admin';
import { clearOtherDefaults, validateLineMeta } from '@/lib/inbound-lines';

const SETTINGS_COLUMNS = ['flags', 'business_hours', 'routing', 'contracts', 'qualification'] as const;

/** Create an intake line. copyFromId copies that line's settings and active instructions (flags start off). */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;

  const body = (await request.json()) as { line?: unknown; copyFromId?: string | null };
  const v = await validateLineMeta(supabase, body.line, null);
  if (!v.ok) return v.response;
  const meta = v.meta;

  let copied: Record<string, unknown> = {};
  let copiedInstructions: unknown = null;
  if (body.copyFromId) {
    const [{ data: src }, { data: instr }] = await Promise.all([
      supabase.from('inbound_lines').select(SETTINGS_COLUMNS.join(', ')).eq('id', body.copyFromId).maybeSingle(),
      supabase.from('inbound_agent_instructions').select('content').eq('line_id', body.copyFromId).eq('is_active', true).maybeSingle(),
    ]);
    if (src) {
      const s = src as unknown as Record<string, unknown>;
      copied = Object.fromEntries(SETTINGS_COLUMNS.map((c) => [c, s[c] ?? {}]));
      copied.flags = {};
    }
    copiedInstructions = instr?.content ?? null;
  }

  if (meta.is_default) {
    const err = await clearOtherDefaults(supabase, null);
    if (err) return NextResponse.json({ error: `Failed to save: ${err}` }, { status: 500 });
  }
  const { data: created, error } = await supabase
    .from('inbound_lines')
    .insert({ ...copied, ...meta, updated_by: userId })
    .select('id')
    .single();
  if (error || !created) return NextResponse.json({ error: `Failed to create line: ${error?.message ?? 'unknown error'}` }, { status: 500 });

  if (copiedInstructions) {
    await supabase.from('inbound_agent_instructions').insert({
      line_id: created.id,
      version: 1,
      content: copiedInstructions,
      is_active: true,
      note: 'Copied when the line was created',
      created_by: userId,
      created_by_email: email,
    });
  }

  await writeInboundAudit(supabase, {
    type: 'SETTINGS_CHANGED',
    actor: 'ADMIN',
    userId,
    data: { section: 'line_created', line_id: created.id, by: email, after: meta, copied_from: body.copyFromId ?? null },
  });
  return NextResponse.json({ ok: true, id: created.id });
}
