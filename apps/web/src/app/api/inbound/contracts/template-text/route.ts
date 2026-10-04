import { NextResponse } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { requireAdmin } from '@/lib/inbound-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CHARS = 60000;

/** Pull the agreement text from a Sign Flow (DocuSeal) template so admins can review it as the AI's contract knowledge. */
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const templateId = Number(new URL(request.url).searchParams.get('templateId'));
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return NextResponse.json({ error: 'Enter a valid template ID' }, { status: 400 });
  }
  const base = process.env.SIGNFLOW_BASE_URL?.trim().replace(/\/$/, '');
  const token = process.env.SIGNFLOW_INTAKE_TOKEN?.trim();
  if (!base || !token) {
    return NextResponse.json({ error: 'SIGNFLOW_BASE_URL and SIGNFLOW_INTAKE_TOKEN are not set on the web app' }, { status: 503 });
  }

  const res = await fetch(`${base}/api/intake/templates/${templateId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  }).catch((e: unknown) => e as Error);
  if (res instanceof Error) return NextResponse.json({ error: `Sign Flow unreachable: ${res.message}` }, { status: 502 });
  const body = (await res.json().catch(() => ({}))) as { error?: string; name?: string; documents?: Array<{ filename: string; url: string }> };
  if (!res.ok) return NextResponse.json({ error: body.error ?? `Sign Flow responded ${res.status}` }, { status: 502 });

  const docs = body.documents ?? [];
  if (docs.length === 0) return NextResponse.json({ error: 'That template has no documents' }, { status: 404 });

  const parts: string[] = [];
  for (const doc of docs) {
    try {
      const pdfRes = await fetch(doc.url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      if (!pdfRes.ok) throw new Error(`download failed (${pdfRes.status})`);
      const pdf = await getDocumentProxy(new Uint8Array(await pdfRes.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: true });
      parts.push(docs.length > 1 ? `## ${doc.filename}\n${text}` : text);
    } catch (e) {
      return NextResponse.json({ error: `Could not read ${doc.filename}: ${e instanceof Error ? e.message : 'unknown error'}` }, { status: 502 });
    }
  }

  const text = parts
    .join('\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return NextResponse.json({ error: 'No text found in the PDF (it may be a scanned image)' }, { status: 422 });
  return NextResponse.json({ name: body.name ?? '', text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS });
}
