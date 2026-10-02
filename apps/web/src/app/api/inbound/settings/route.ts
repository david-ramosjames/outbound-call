import { NextRequest, NextResponse } from 'next/server';
import {
  businessHoursSchema,
  contractsSchema,
  inboundFlagsSchema,
  qualificationConfigSchema,
  routingSchema,
} from '@outbound-call/shared';
import { requireStaff, writeInboundAudit } from '@/lib/inbound-admin';

const SECTION_SCHEMAS = {
  flags: inboundFlagsSchema,
  business_hours: businessHoursSchema,
  routing: routingSchema,
  contracts: contractsSchema,
  qualification: qualificationConfigSchema,
} as const;
type Section = keyof typeof SECTION_SCHEMAS;

export async function PUT(request: NextRequest) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;

  const body = (await request.json()) as { section?: string; value?: unknown };
  if (!body.section || !(body.section in SECTION_SCHEMAS)) {
    return NextResponse.json({ error: 'Unknown settings section' }, { status: 400 });
  }
  const section = body.section as Section;
  const parsed = SECTION_SCHEMAS[section].safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { data: before } = await supabase.from('inbound_settings').select(section).eq('id', 1).maybeSingle();
  const { error } = await supabase
    .from('inbound_settings')
    .upsert({ id: 1, [section]: parsed.data, updated_by: userId, updated_at: new Date().toISOString() });
  if (error) {
    return NextResponse.json({ error: `Failed to save: ${error.message}` }, { status: 500 });
  }

  await writeInboundAudit(supabase, {
    type: 'SETTINGS_CHANGED',
    actor: 'ADMIN',
    userId,
    data: { section, by: email, before: (before as Record<string, unknown> | null)?.[section] ?? null, after: parsed.data },
  });

  return NextResponse.json({ ok: true, value: parsed.data });
}
