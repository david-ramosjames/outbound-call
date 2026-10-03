import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/inbound-admin';

export const maxDuration = 120;

/** Proxy a Test Agent turn to the voice worker (which holds the xAI key). Nothing is written to intake tables. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const workerUrl = process.env.VOICE_WORKER_BASE_URL;
  const workerSecret = process.env.VOICE_WORKER_INTERNAL_SECRET;
  if (!workerUrl || !workerSecret) {
    return NextResponse.json({ error: 'VOICE_WORKER_BASE_URL / VOICE_WORKER_INTERNAL_SECRET not configured' }, { status: 503 });
  }

  try {
    const res = await fetch(`${workerUrl}/internal/inbound/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': workerSecret },
      body: await request.text(),
    });
    const text = await res.text();
    return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[inbound test] worker unreachable', err);
    return NextResponse.json({ error: 'Voice worker unreachable' }, { status: 502 });
  }
}
