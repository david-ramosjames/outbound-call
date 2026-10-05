import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/inbound-admin';
import { workerFetch } from '@/lib/voice-worker';

export const maxDuration = 120;

/** Proxy a Test Agent turn to the voice worker (which holds the xAI key). Nothing is written to intake tables. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return workerFetch('/internal/inbound/simulate', { method: 'POST', body: await request.text(), timeoutMs: 115_000 });
}
