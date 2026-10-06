import { NextRequest } from 'next/server';
import { requireStaff } from '@/lib/inbound-admin';
import { workerFetch } from '@/lib/voice-worker';

export const dynamic = 'force-dynamic';

/** Voices for a provider (Grok: built-in + this team's custom voices; OpenAI: its realtime voices), via the voice worker. */
export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  const params = new URLSearchParams();
  if (req.nextUrl.searchParams.get('provider') === 'openai') params.set('provider', 'openai');
  if (req.nextUrl.searchParams.get('refresh') === '1') params.set('refresh', '1');
  const qs = params.toString();
  return workerFetch(`/internal/voices${qs ? `?${qs}` : ''}`, { timeoutMs: 15_000 });
}
