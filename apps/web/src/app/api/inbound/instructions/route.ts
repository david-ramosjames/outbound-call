import { NextRequest, NextResponse } from 'next/server';
import { agentInstructionsSchema } from '@outbound-call/shared';
import { requireStaff, writeInboundAudit } from '@/lib/inbound-admin';

/** Save agent instructions as a new active version. Older versions are kept for rollback. */
export async function POST(request: NextRequest) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;

  const body = (await request.json()) as { content?: unknown; note?: string };
  const parsed = agentInstructionsSchema.safeParse(body.content);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { data: latest } = await supabase
    .from('inbound_agent_instructions')
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = ((latest?.version as number | undefined) ?? 0) + 1;

  const { error: deactivateError } = await supabase
    .from('inbound_agent_instructions')
    .update({ is_active: false })
    .eq('is_active', true);
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
  });
  if (error) {
    return NextResponse.json({ error: `Failed to save: ${error.message}` }, { status: 500 });
  }

  await writeInboundAudit(supabase, {
    type: 'INSTRUCTIONS_CHANGED',
    actor: 'ADMIN',
    userId,
    data: { version, by: email, note: body.note ?? null },
  });
  return NextResponse.json({ ok: true, version });
}
