import { NextResponse } from 'next/server';

/** Server-side call to a voice worker internal endpoint (the worker holds the Sign Flow token and xAI key). */
export async function workerFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<NextResponse> {
  const workerUrl = process.env.VOICE_WORKER_BASE_URL?.trim().replace(/\/$/, '');
  const workerSecret = process.env.VOICE_WORKER_INTERNAL_SECRET?.trim();
  if (!workerUrl || !workerSecret) {
    return NextResponse.json({ error: 'VOICE_WORKER_BASE_URL / VOICE_WORKER_INTERNAL_SECRET not configured on the web app' }, { status: 503 });
  }
  const { timeoutMs = 30_000, ...rest } = init;
  try {
    const res = await fetch(`${workerUrl}${path}`, {
      ...rest,
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': workerSecret, ...(rest.headers ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return new NextResponse(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[inbound] voice worker unreachable', path, err);
    return NextResponse.json({ error: 'Voice worker unreachable' }, { status: 502 });
  }
}
