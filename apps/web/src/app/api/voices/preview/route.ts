import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/inbound-admin';
import { workerFetch } from '@/lib/voice-worker';

export const dynamic = 'force-dynamic';

/** Short spoken sample of a voice (base64 MP3). */
export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as { voice?: string; text?: string } | null;
  if (!body?.voice || !body.text) return NextResponse.json({ error: 'voice and text are required' }, { status: 400 });
  return workerFetch('/internal/voices/preview', {
    method: 'POST',
    body: JSON.stringify({ voice: body.voice, text: body.text.slice(0, 300) }),
    timeoutMs: 25_000,
  });
}
