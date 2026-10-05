import { NextResponse } from 'next/server';
import { inboundLineMetaSchema, normalizeE164, type InboundLineMeta } from '@outbound-call/shared';
import type { requireStaff } from './inbound-admin';

type ServerClient = Extract<Awaited<ReturnType<typeof requireStaff>>, { ok: true }>['supabase'];

/** Validate line details: normalized E.164 numbers that no other line already answers. */
export async function validateLineMeta(
  supabase: ServerClient,
  raw: unknown,
  excludeId: string | null,
): Promise<{ ok: true; meta: InboundLineMeta } | { ok: false; response: NextResponse }> {
  const parsed = inboundLineMetaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 }) };
  }
  const meta = parsed.data;

  const numbers: string[] = [];
  for (const p of meta.phone_numbers.map((x) => x.trim()).filter(Boolean)) {
    const n = normalizeE164(p);
    if (!n) return { ok: false, response: NextResponse.json({ error: `"${p}" is not a valid phone number` }, { status: 400 }) };
    if (!numbers.includes(n)) numbers.push(n);
  }
  meta.phone_numbers = numbers;

  const { data: others, error } = await supabase.from('inbound_lines').select('id, name, slug, phone_numbers');
  if (error) return { ok: false, response: NextResponse.json({ error: `Could not load lines: ${error.message}` }, { status: 500 }) };
  for (const o of others ?? []) {
    if (o.id === excludeId) continue;
    if (o.slug === meta.slug) {
      return { ok: false, response: NextResponse.json({ error: `The short name "${meta.slug}" is already used by ${o.name}` }, { status: 409 }) };
    }
    const clash = numbers.find((n) => ((o.phone_numbers as string[] | null) ?? []).some((p) => normalizeE164(p) === n));
    if (clash) {
      return { ok: false, response: NextResponse.json({ error: `${clash} already belongs to ${o.name}` }, { status: 409 }) };
    }
  }
  return { ok: true, meta };
}

/** Only one default line: clear the flag elsewhere before setting it. */
export async function clearOtherDefaults(supabase: ServerClient, keepId: string | null): Promise<string | null> {
  let q = supabase.from('inbound_lines').update({ is_default: false }).eq('is_default', true);
  if (keepId) q = q.neq('id', keepId);
  const { error } = await q;
  return error?.message ?? null;
}
