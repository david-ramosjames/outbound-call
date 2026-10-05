import { requireAdmin } from '@/lib/inbound-admin';
import { workerFetch } from '@/lib/voice-worker';

export const dynamic = 'force-dynamic';

/** DocuSeal templates of one Sign Flow account (firmId), via the voice worker. */
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const firmId = new URL(request.url).searchParams.get('firmId')?.trim() ?? '';
  return workerFetch(`/internal/inbound/signflow/templates${firmId ? `?firmId=${encodeURIComponent(firmId)}` : ''}`);
}
