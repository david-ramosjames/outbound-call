import { requireStaff } from '@/lib/inbound-admin';
import { workerFetch } from '@/lib/voice-worker';

export const dynamic = 'force-dynamic';

/** Which voice providers have their keys set on the voice worker. */
export async function GET() {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  return workerFetch('/internal/voices/providers', { timeoutMs: 10_000 });
}
