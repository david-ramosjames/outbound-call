import { NextRequest, NextResponse } from 'next/server';
import { inboundIntegrationsSchema } from '@outbound-call/shared';
import { requireAdmin, writeInboundAudit } from '@/lib/inbound-admin';
import { workerFetch } from '@/lib/voice-worker';

export const dynamic = 'force-dynamic';

async function json(res: NextResponse): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Configuration health: which env vars are set on each service (booleans only), plus the Sign Flow connection. */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const set = (v: string | undefined) => Boolean(v && v.trim());
  const web = {
    NEXT_PUBLIC_SUPABASE_URL: set(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: set(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: set(process.env.SUPABASE_SERVICE_ROLE_KEY),
    NEXT_PUBLIC_APP_URL: set(process.env.NEXT_PUBLIC_APP_URL) && !process.env.NEXT_PUBLIC_APP_URL!.includes('localhost'),
    VOICE_WORKER_BASE_URL: set(process.env.VOICE_WORKER_BASE_URL),
    VOICE_WORKER_INTERNAL_SECRET: set(process.env.VOICE_WORKER_INTERNAL_SECRET),
  };

  const [worker, signflow, settings] = await Promise.all([
    json(await workerFetch('/internal/inbound/env-status', { timeoutMs: 10_000 })),
    json(await workerFetch('/internal/inbound/signflow/health', { timeoutMs: 15_000 })),
    auth.supabase.from('inbound_settings').select('integrations').eq('id', 1).maybeSingle(),
  ]);

  return NextResponse.json({
    web,
    worker: worker.ok ? worker.body : { error: worker.body.error ?? `Voice worker responded ${worker.status}` },
    signflow: signflow.ok ? signflow.body : { error: signflow.body.error ?? `Sign Flow check failed (${signflow.status})` },
    integrations: (settings.data as { integrations?: unknown } | null)?.integrations ?? {},
    integrationsAvailable: !settings.error,
  });
}

/** Save non-secret integration settings (e.g. the Sign Flow URL). */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;

  const parsed = inboundIntegrationsSchema.safeParse((await request.json()).integrations);
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  const value = { ...parsed.data, signflow_base_url: parsed.data.signflow_base_url.replace(/\/+$/, '') };

  const { data: updated, error } = await supabase
    .from('inbound_settings')
    .update({ integrations: value, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('id');
  if (error) return NextResponse.json({ error: `Failed to save: ${error.message}` }, { status: 500 });
  if (!updated?.length) return NextResponse.json({ error: 'Failed to save: settings row not found or you are not an admin' }, { status: 403 });

  await writeInboundAudit(supabase, { type: 'SETTINGS_CHANGED', actor: 'ADMIN', userId, data: { section: 'integrations', by: email, after: value } });
  return NextResponse.json({ ok: true, value });
}
