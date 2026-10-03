import { NextResponse } from 'next/server';
import type { AuditActor, AuditEventType } from '@outbound-call/shared';
import { createClient } from '@/lib/supabase/server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Resolve the signed-in staff member for an inbound admin API route. */
export async function requireStaff(): Promise<
  { ok: true; supabase: ServerClient; userId: string; email: string } | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  return { ok: true, supabase, userId: user.id, email: user.email ?? '' };
}

export async function isInboundAdmin(supabase: ServerClient): Promise<boolean> {
  const { data, error } = await supabase.rpc('case_tracker_is_admin');
  if (error) {
    console.error('[inbound] admin check failed', error.message);
    return false;
  }
  return data === true;
}

/** Inbound configuration (settings, rules, instructions) is admin-only. */
export async function requireAdmin(): ReturnType<typeof requireStaff> {
  const auth = await requireStaff();
  if (!auth.ok) return auth;
  if (!(await isInboundAdmin(auth.supabase))) {
    return { ok: false, response: NextResponse.json({ error: 'Only admins can use inbound intake' }, { status: 403 }) };
  }
  return auth;
}

export async function writeInboundAudit(
  supabase: ServerClient,
  input: {
    type: AuditEventType;
    actor: AuditActor;
    userId: string;
    data?: Record<string, unknown>;
    callId?: string | null;
    intakeId?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from('inbound_audit_events').insert({
    event_type: input.type,
    actor: input.actor,
    actor_user_id: input.userId,
    event_data: input.data ?? {},
    call_id: input.callId ?? null,
    intake_id: input.intakeId ?? null,
  });
  if (error) console.error('[inbound] audit insert failed', error.message);
}
