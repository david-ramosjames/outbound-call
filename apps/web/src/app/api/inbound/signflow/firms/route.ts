import { requireAdmin } from '@/lib/inbound-admin';
import { workerFetch } from '@/lib/voice-worker';

export const dynamic = 'force-dynamic';

/** Sign Flow accounts (firms), via the voice worker's Sign Flow health check. */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return workerFetch('/internal/inbound/signflow/health', { timeoutMs: 15_000 });
}
