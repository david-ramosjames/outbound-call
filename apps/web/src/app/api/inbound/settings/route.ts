import { NextRequest, NextResponse } from 'next/server';
import {
  businessHoursSchema,
  contractsSchema,
  inboundFlagsSchema,
  qualificationConfigSchema,
  routingSchema,
} from '@outbound-call/shared';
import { requireAdmin, writeInboundAudit } from '@/lib/inbound-admin';

const SECTION_SCHEMAS = {
  flags: inboundFlagsSchema,
  business_hours: businessHoursSchema,
  routing: routingSchema,
  contracts: contractsSchema,
  qualification: qualificationConfigSchema,
} as const;
type Section = keyof typeof SECTION_SCHEMAS;

/** Save one settings section for an intake line (lineId), or the legacy single row when lineId is null. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;

  const body = (await request.json()) as { section?: string; value?: unknown; lineId?: string | null };
  if (!body.section || !(body.section in SECTION_SCHEMAS)) {
    return NextResponse.json({ error: 'Unknown settings section' }, { status: 400 });
  }
  const section = body.section as Section;
  const parsed = SECTION_SCHEMAS[section].safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const table = body.lineId ? 'inbound_lines' : 'inbound_settings';
  const key = body.lineId ? { col: 'id', val: body.lineId } : { col: 'id', val: 1 };

  const { data: before } = await supabase.from(table).select(section).eq(key.col, key.val).maybeSingle();
  const { data: updated, error } = await supabase
    .from(table)
    .update({ [section]: parsed.data, updated_by: userId, updated_at: new Date().toISOString() })
    .eq(key.col, key.val)
    .select('id');
  if (error) {
    return NextResponse.json({ error: `Failed to save: ${error.message}` }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: 'Failed to save: settings row not found or your account is not an admin. Re-run the inbound migrations and check case_tracker_user_roles.' },
      { status: 403 },
    );
  }

  await writeInboundAudit(supabase, {
    type: 'SETTINGS_CHANGED',
    actor: 'ADMIN',
    userId,
    data: {
      section,
      line_id: body.lineId ?? null,
      by: email,
      before: (before as Record<string, unknown> | null)?.[section] ?? null,
      after: parsed.data,
    },
  });

  return NextResponse.json({ ok: true, value: parsed.data });
}
