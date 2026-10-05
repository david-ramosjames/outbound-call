import { NextRequest, NextResponse } from 'next/server';
import { agentInstructionsSchema } from '@outbound-call/shared';
import { requireAdmin, writeInboundAudit } from '@/lib/inbound-admin';

/** Save agent instructions as a new active version for a line. Older versions are kept for rollback. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;

  const body = (await request.json()) as { content?: unknown; note?: string; lineId?: string | null };
  const parsed = agentInstructionsSchema.safeParse(body.content);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }
  const lineId = body.lineId || null;

  let latestQuery = supabase.from('inbound_agent_instructions').select('version').order('version', { ascending: false }).limit(1);
  if (lineId) latestQuery = latestQuery.eq('line_id', lineId);
  const { data: latest } = await latestQuery.maybeSingle();
  const version = ((latest?.version as number | undefined) ?? 0) + 1;

  let deactivate = supabase.from('inbound_agent_instructions').update({ is_active: false }).eq('is_active', true);
  if (lineId) deactivate = deactivate.eq('line_id', lineId);
  const { error: deactivateError } = await deactivate;
  if (deactivateError) {
    return NextResponse.json({ error: `Failed to save: ${deactivateError.message}` }, { status: 500 });
  }

  const { error } = await supabase.from('inbound_agent_instructions').insert({
    version,
    content: parsed.data,
    is_active: true,
    note: body.note?.slice(0, 500) || null,
    created_by: userId,
    created_by_email: email,
    ...(lineId ? { line_id: lineId } : {}),
  });
  if (error) {
    return NextResponse.json({ error: `Failed to save: ${error.message}` }, { status: 500 });
  }

  await writeInboundAudit(supabase, {
    type: 'INSTRUCTIONS_CHANGED',
    actor: 'ADMIN',
    userId,
    data: { version, line_id: lineId, by: email, note: body.note ?? null },
  });
  return NextResponse.json({ ok: true, version });
}
