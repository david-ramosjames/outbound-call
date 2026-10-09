import { formatIntakeSummary, normalizeE164, type InboundIntakeState } from '@outbound-call/shared';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { getInboundCall, loadIntakeForCall, loadLineSettings, updateInboundCall, writeAudit } from './store.js';

const SLACK_API = 'https://slack.com/api';
const HISTORY_DAYS = 7;
const MAX_HISTORY_PAGES = 10;
const CHUNK_CHARS = 3500;

export interface SlackMessage {
  ts?: string;
  thread_ts?: string;
  text?: string;
  attachments?: Array<{ text?: string; fallback?: string; pretext?: string; title?: string; fields?: Array<{ title?: string; value?: string }> }>;
  blocks?: Array<{ text?: { text?: string }; fields?: Array<{ text?: string }>; elements?: Array<{ text?: string | { text?: string }; value?: string }> }>;
}

/** Token for a line: SLACK_BOT_TOKEN_<SLUG> (e.g. SLACK_BOT_TOKEN_RAMOS_JAMES), else SLACK_BOT_TOKEN. */
export function slackTokenFor(slug: string): string {
  const key = `SLACK_BOT_TOKEN_${slug.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  return (slug && process.env[key]?.trim()) || config.SLACK_BOT_TOKEN.trim();
}

function lastTen(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function messageText(msg: SlackMessage): string {
  const parts = [msg.text ?? ''];
  for (const a of msg.attachments ?? []) {
    parts.push(a.text ?? '', a.fallback ?? '', a.pretext ?? '', a.title ?? '');
    for (const f of a.fields ?? []) parts.push(f.title ?? '', f.value ?? '');
  }
  for (const b of msg.blocks ?? []) {
    parts.push(b.text?.text ?? '');
    for (const f of b.fields ?? []) parts.push(f.text ?? '');
    for (const el of b.elements ?? []) parts.push(typeof el.text === 'string' ? el.text : (el.text?.text ?? ''), el.value ?? '');
  }
  return parts.join(' ');
}

const PHONE_PATTERN = /(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/g;

/** Root ts of the earliest post in the channel that mentions one of the phone numbers (matched on the last 10 digits). */
export function findThreadForPhones(messages: SlackMessage[], phones: string[]): string | null {
  const targets = new Set(phones.map(lastTen).filter(Boolean));
  if (targets.size === 0) return null;
  const roots: string[] = [];
  for (const msg of messages) {
    if (!msg.ts) continue;
    const found = (messageText(msg).match(PHONE_PATTERN) ?? []).some((m) => targets.has(lastTen(m)));
    if (found) roots.push(msg.thread_ts || msg.ts);
  }
  return roots.sort((a, b) => parseFloat(a) - parseFloat(b))[0] ?? null;
}

function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatPhone(phone: string | null | undefined): string {
  const e164 = phone ? normalizeE164(phone) : null;
  if (!e164 || !e164.startsWith('+1') || e164.length !== 12) return phone ?? 'Unknown';
  return `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

/** The main post: who called, the staff summary, and a link to the call in the dashboard. */
export function formatSlackSummary(input: {
  firmName: string;
  state: InboundIntakeState;
  callerNumber: string | null;
  durationSeconds?: number | null;
  callUrl: string;
}): string {
  const [headline, ...rest] = formatIntakeSummary(input.state).split('\n');
  const body = rest
    .map((line) => (/^[A-Z][A-Za-z ]+:$/.test(line.trim()) ? `*${escapeSlack(line.trim())}*` : escapeSlack(line)))
    .join('\n')
    .trim();
  const meta = [`Called from ${formatPhone(input.callerNumber)}`, formatDuration(input.durationSeconds), `<${input.callUrl}|Open call>`]
    .filter(Boolean)
    .join(' · ');
  return `:robot_face: *AI Intake · ${escapeSlack(input.firmName)}* — *${escapeSlack(headline ?? 'CALL')}*\n${meta}\n\n${body}`;
}

/** Transcript lines split into Slack-sized replies. */
export function formatSlackTranscript(segments: Array<{ speaker: string; text: string }>): string[] {
  const lines = segments
    .filter((s) => s.text.trim())
    .map((s) =>
      s.speaker === 'system' ? `_${escapeSlack(s.text.trim())}_` : `*${s.speaker === 'agent' ? 'AI' : 'Caller'}:* ${escapeSlack(s.text.trim())}`,
    );
  if (lines.length === 0) return [];
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    const piece = line.length > CHUNK_CHARS ? `${line.slice(0, CHUNK_CHARS - 1)}…` : line;
    if (current && current.length + piece.length + 1 > CHUNK_CHARS) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n${piece}` : piece;
  }
  if (current) chunks.push(current);
  return chunks.map((c, i) => `*Transcript${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}*\n${c}`);
}

async function slackCall<T>(token: string, method: string, body: Record<string, unknown>): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T & { ok: boolean; error?: string };
}

async function channelHistory(token: string, channel: string): Promise<SlackMessage[]> {
  const oldest = String(Math.floor((Date.now() - HISTORY_DAYS * 86_400_000) / 1000));
  const out: SlackMessage[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const url = new URL(`${SLACK_API}/conversations.history`);
    url.searchParams.set('channel', channel);
    url.searchParams.set('limit', '200');
    url.searchParams.set('oldest', oldest);
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json()) as { ok: boolean; error?: string; messages?: SlackMessage[]; response_metadata?: { next_cursor?: string } };
    if (!json.ok) throw new Error(`conversations.history: ${json.error ?? 'failed'}`);
    out.push(...(json.messages ?? []));
    cursor = json.response_metadata?.next_cursor ?? '';
    if (!cursor) break;
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const posted = new Set<string>();

/**
 * Post a finished inbound call to the line's Slack channel: the summary (in the caller's
 * existing thread when there is one, otherwise as a new post) and the transcript as replies.
 * Never throws; posts each call at most once.
 */
export async function postInboundCallToSlack(callId: string): Promise<void> {
  if (posted.has(callId)) return;
  posted.add(callId);
  try {
    const call = await getInboundCall(callId);
    if (!call || call.simulated || call.slack_message_ts) return;
    const { line, config: lineConfig } = await loadLineSettings(call.line_id);
    const slack = lineConfig.slack;
    if (!slack.enabled || !slack.channel_id) return;
    const token = slackTokenFor(line.slug);
    if (!token) {
      logger.warn('Slack posting is on for this line but no bot token is set', { inboundCallId: callId, line: line.slug });
      return;
    }
    const state = await loadIntakeForCall(callId);
    if (!state) return;

    // Let the last transcript lines land before reading them.
    await sleep(3000);
    const { data: segments } = await supabase
      .from('inbound_transcript_segments')
      .select('speaker, text')
      .eq('call_id', callId)
      .order('id', { ascending: true });
    const transcript = (segments ?? []) as Array<{ speaker: string; text: string }>;
    if (!transcript.some((s) => s.speaker === 'caller')) return;

    const own = new Set(line.phone_numbers.map(lastTen));
    const phones = [call.from_number, state.facts.phone]
      .filter((p): p is string => Boolean(p))
      .filter((p) => !own.has(lastTen(p)));

    let parentTs: string | null = null;
    if (slack.thread_by_phone && phones.length) {
      try {
        parentTs = findThreadForPhones(await channelHistory(token, slack.channel_id), phones);
        if (!parentTs) {
          await sleep(5000);
          parentTs = findThreadForPhones(await channelHistory(token, slack.channel_id), phones);
        }
      } catch (err) {
        logger.warn('Slack thread search failed; posting a new message', { inboundCallId: callId, errorMessage: (err as Error).message });
      }
    }

    const summary = formatSlackSummary({
      firmName: lineConfig.firm_name,
      state,
      callerNumber: call.from_number,
      durationSeconds: call.duration_seconds,
      callUrl: `${config.APP_BASE_URL.replace(/\/$/, '')}/inbound/calls/${callId}`,
    });
    const main = await slackCall<{ ts?: string }>(token, 'chat.postMessage', {
      channel: slack.channel_id,
      text: summary,
      unfurl_links: false,
      ...(parentTs ? { thread_ts: parentTs } : {}),
    });
    if (!main.ok || !main.ts) throw new Error(`chat.postMessage: ${main.error ?? 'no ts'}`);
    const threadTs = parentTs ?? main.ts;

    if (slack.include_transcript) {
      for (const chunk of formatSlackTranscript(transcript)) {
        const reply = await slackCall(token, 'chat.postMessage', { channel: slack.channel_id, thread_ts: threadTs, text: chunk, unfurl_links: false });
        if (!reply.ok) logger.warn('Slack transcript reply failed', { inboundCallId: callId, errorMessage: reply.error });
      }
    }

    await updateInboundCall(callId, { slack_channel_id: slack.channel_id, slack_message_ts: main.ts, slack_thread_ts: threadTs });
    await writeAudit({ callId, intakeId: state.intakeId }, {
      type: 'SLACK_POSTED',
      actor: 'SYSTEM',
      data: { channel: slack.channel_id, ts: main.ts, threaded: Boolean(parentTs) },
    });
    logger.info('Inbound call posted to Slack', { inboundCallId: callId, threaded: Boolean(parentTs) });
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Failed to post inbound call to Slack', { inboundCallId: callId, errorMessage: message });
    await writeAudit({ callId }, { type: 'SLACK_FAILED', actor: 'SYSTEM', data: { error: message } });
  }
}
