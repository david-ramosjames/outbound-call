import { NextRequest } from 'next/server';
import { requireStaff } from '@/lib/inbound-admin';
import { workerFetch } from '@/lib/voice-worker';

export const dynamic = 'force-dynamic';

/** xAI voices (built-in + this team's custom voices), via the voice worker. */
export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  const refresh = req.nextUrl.searchParams.get('refresh') === '1' ? '?refresh=1' : '';
  return workerFetch(`/internal/voices${refresh}`, { timeoutMs: 15_000 });
}
