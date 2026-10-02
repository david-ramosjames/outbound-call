'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Send } from 'lucide-react';
import {
  INBOUND_CASE_TYPE_LABELS,
  INBOUND_CASE_TYPES,
  INTAKE_FACT_LABELS,
  type IntakeFactKey,
} from '@outbound-call/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Toggle } from '@/components/ui/toggle';
import { InboundPageHeader, selectClass } from '@/components/inbound/page-header';
import { QualificationBadge } from '@/components/inbound/badges';
import { cn } from '@/lib/utils';

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface TurnResult {
  reply: string;
  messages: ChatMessage[];
  state: Record<string, any>;
  toolCalls: Array<{ name: string; args: unknown; ok: boolean; output: unknown }>;
  guardrails: Array<{ category: string; match: string }>;
  audit: Array<{ type: string; actor: string; data?: Record<string, unknown> }>;
  sideEffects: { sms: Array<{ to: string; body: string }>; transfers: Array<{ number: string; label: string }>; contracts: Array<{ to: string }> };
  business: { status: string; localTime: string; nextOpenPhrase: string | null; overridden: boolean };
  actions: {
    canTransfer: boolean;
    transferBlockedReason: string | null;
    nextTransferTarget: { label: string; number: string } | null;
    canOfferContract: boolean;
    contractBlockedReason: string | null;
    canSendSms: boolean;
    urgent: boolean;
    recommendedNextAction: string;
    callbackPriority: string;
  };
  stage: string;
  missing: { mode: string; missing: Array<{ key: string; label: string }>; declined: string[] };
  summary: string;
}

interface Overrides {
  language: 'en' | 'es';
  businessStatus: '' | 'business_hours' | 'after_hours' | 'closed';
  caseType: string;
  enableAllActions: boolean;
  transferOutcome: 'connected' | 'no_answer';
  contractOutcome: 'success' | 'fail';
}

const SAMPLES = [
  "I was hit by an 18 wheeler yesterday and I'm in the hospital.",
  'Me chocaron por detrás hace una semana en Houston y me duele el cuello.',
  'I slipped at a grocery store last month and hurt my back.',
  "I'm already a client, I have a question about my case.",
  'How much is my case worth?',
  'Should I give the insurance company a recorded statement?',
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="py-3 text-sm">{children}</CardContent>
    </Card>
  );
}

function YesNo({ ok, label, reason }: { ok: boolean; label: string; reason?: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <span className={cn('mt-1 h-2 w-2 rounded-full shrink-0', ok ? 'bg-emerald-500' : 'bg-slate-300')} />
      <div>
        <p className="font-medium text-slate-900">{label}: {ok ? 'Yes' : 'No'}</p>
        {!ok && reason && <p className="text-xs text-slate-500">{reason}</p>}
      </div>
    </div>
  );
}

export default function TestAgentPage() {
  const [overrides, setOverrides] = useState<Overrides>({
    language: 'en',
    businessStatus: '',
    caseType: '',
    enableAllActions: true,
    transferOutcome: 'connected',
    contractOutcome: 'success',
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<Record<string, any> | null>(null);
  const [result, setResult] = useState<TurnResult | null>(null);
  const [allToolCalls, setAllToolCalls] = useState<TurnResult['toolCalls']>([]);
  const [allAudit, setAllAudit] = useState<TurnResult['audit']>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const turn = async (userMessage: string, fresh = false) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/inbound/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: fresh ? [] : messages,
          userMessage,
          state: fresh ? null : state,
          overrides: {
            language: overrides.language,
            businessStatus: overrides.businessStatus || null,
            caseType: overrides.caseType || null,
            enableAllActions: overrides.enableAllActions,
            transferOutcome: overrides.transferOutcome,
            contractOutcome: overrides.contractOutcome,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      const r = body as TurnResult;
      setResult(r);
      setMessages(r.messages);
      setState(r.state);
      setAllToolCalls((prev) => (fresh ? r.toolCalls : [...prev, ...r.toolCalls]));
      setAllAudit((prev) => (fresh ? r.audit : [...prev, ...r.audit]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    setMessages([]);
    setState(null);
    setResult(null);
    setAllToolCalls([]);
    setAllAudit([]);
    void turn('', true);
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: text }]);
    void turn(text);
  };

  const visible = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content);
  const facts = (state?.facts ?? {}) as Record<string, unknown>;
  const qualification = state?.qualification as { result: string; reasons: string[]; canSendContract: boolean; urgentIndicators: string[] } | null | undefined;

  return (
    <div className="space-y-6">
      <InboundPageHeader
        title="Test Agent"
        description="Play the caller by text. Uses the live instructions and rules; nothing is saved, transferred, or texted for real."
      />

      <Card>
        <CardContent className="pt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Starting language</label>
            <select className={selectClass} value={overrides.language} onChange={(e) => setOverrides((o) => ({ ...o, language: e.target.value as Overrides['language'] }))}>
              <option value="en">English</option>
              <option value="es">Spanish</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Office status</label>
            <select className={selectClass} value={overrides.businessStatus} onChange={(e) => setOverrides((o) => ({ ...o, businessStatus: e.target.value as Overrides['businessStatus'] }))}>
              <option value="">Actual (now)</option>
              <option value="business_hours">Business hours</option>
              <option value="after_hours">After hours</option>
              <option value="closed">Closed / holiday</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Case type</label>
            <select className={selectClass} value={overrides.caseType} onChange={(e) => setOverrides((o) => ({ ...o, caseType: e.target.value }))}>
              <option value="">Let the caller say</option>
              {INBOUND_CASE_TYPES.map((t) => <option key={t} value={t}>{INBOUND_CASE_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Transfer outcome</label>
            <select className={selectClass} value={overrides.transferOutcome} onChange={(e) => setOverrides((o) => ({ ...o, transferOutcome: e.target.value as Overrides['transferOutcome'] }))}>
              <option value="connected">Staff answers</option>
              <option value="no_answer">Nobody answers</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Agreement send</label>
            <select className={selectClass} value={overrides.contractOutcome} onChange={(e) => setOverrides((o) => ({ ...o, contractOutcome: e.target.value as Overrides['contractOutcome'] }))}>
              <option value="success">Succeeds</option>
              <option value="fail">Fails</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Toggle
              checked={overrides.enableAllActions}
              onChange={(v) => setOverrides((o) => ({ ...o, enableAllActions: v }))}
              label="Simulate all actions"
              description="Transfers, SMS, agreements on"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-4">
          <Card className="flex flex-col h-[640px]">
            <CardHeader className="py-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Conversation</CardTitle>
              <Button size="sm" variant="outline" onClick={start} disabled={busy}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> {messages.length ? 'Restart call' : 'Start call'}
              </Button>
            </CardHeader>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {visible.length === 0 && !busy && <p className="text-sm text-slate-500">Press &ldquo;Start call&rdquo; to hear the greeting, then type as the caller.</p>}
              {visible.map((m, i) => (
                <div key={i} className={cn('flex', m.role === 'assistant' ? 'justify-start' : 'justify-end')}>
                  <div className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap', m.role === 'assistant' ? 'bg-navy-50 text-slate-900' : 'bg-navy-800 text-white')}>
                    {m.content}
                  </div>
                </div>
              ))}
              {busy && <p className="text-xs text-slate-400">Agent is thinking...</p>}
              <div ref={bottomRef} />
            </div>
            <div className="border-t border-slate-100 p-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {SAMPLES.map((s) => (
                  <button key={s} type="button" className="text-xs rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50" onClick={() => setInput(s)}>
                    {s.length > 48 ? `${s.slice(0, 48)}…` : s}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <input
                  className={selectClass}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={messages.length ? 'Type what the caller says…' : 'Start the call first'}
                  disabled={busy || messages.length === 0}
                />
                <Button type="submit" disabled={busy || !input.trim() || messages.length === 0}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          </Card>

          {result?.summary && (
            <Section title="Staff summary (as it would be saved)">
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800">{result.summary}</pre>
            </Section>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <Section title="Intake state">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <QualificationBadge result={qualification?.result} />
              {result && <span className="text-xs text-slate-500">Stage: {result.stage.replace(/_/g, ' ')}</span>}
              {state && <span className="text-xs text-slate-500">Language: {state.language === 'es' ? 'Spanish' : 'English'}</span>}
              {state && <span className="text-xs text-slate-500">Status: {String(state.status).replace(/_/g, ' ')}</span>}
            </div>
            {result && <p className="text-xs text-slate-600">Next step: <strong>{result.actions.recommendedNextAction.replace(/_/g, ' ')}</strong>{result.actions.urgent ? ' · URGENT' : ''}</p>}
            {(qualification?.reasons ?? []).length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">{qualification!.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            )}
          </Section>

          {result && (
            <Section title="Business hours & eligibility">
              <div className="space-y-2">
                <p className="text-xs text-slate-600">
                  Office: <strong className="capitalize">{result.business.status.replace('_', ' ')}</strong>
                  {result.business.overridden ? ' (override)' : ''} · {result.business.localTime}
                  {result.business.nextOpenPhrase ? ` · opens ${result.business.nextOpenPhrase}` : ''}
                </p>
                <YesNo ok={result.actions.canTransfer} label="Transfer eligible" reason={result.actions.transferBlockedReason} />
                <YesNo ok={result.actions.canOfferContract} label="Agreement eligible" reason={result.actions.contractBlockedReason} />
                <YesNo ok={result.actions.canSendSms} label="Can text caller" />
              </div>
            </Section>
          )}

          <Section title="Facts extracted">
            {Object.keys(facts).length === 0 ? (
              <p className="text-xs text-slate-500">None yet.</p>
            ) : (
              <dl className="space-y-1 text-xs">
                {Object.entries(facts)
                  .filter(([, v]) => v !== null && v !== undefined)
                  .map(([k, v]) => (
                    <div key={k} className="grid grid-cols-5 gap-2">
                      <dt className="col-span-2 text-slate-500">{INTAKE_FACT_LABELS[k as IntakeFactKey] ?? k}</dt>
                      <dd className="col-span-3 text-slate-900 break-words">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                    </div>
                  ))}
              </dl>
            )}
            {result && result.missing.missing.length > 0 && (
              <p className="mt-2 text-xs text-amber-700">Still needed: {result.missing.missing.map((m) => m.label).join(', ')}</p>
            )}
          </Section>

          <Section title={`Tool calls (${allToolCalls.length})`}>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {allToolCalls.length === 0 && <p className="text-xs text-slate-500">None yet.</p>}
              {allToolCalls.map((t, i) => (
                <details key={i} className="rounded border border-slate-200 px-2 py-1">
                  <summary className={cn('cursor-pointer text-xs font-mono', t.ok ? 'text-slate-800' : 'text-red-700')}>
                    {t.ok ? '✓' : '✗'} {t.name}
                  </summary>
                  <pre className="mt-1 text-[11px] whitespace-pre-wrap break-words text-slate-600">args: {JSON.stringify(t.args, null, 1)}</pre>
                  <pre className="mt-1 text-[11px] whitespace-pre-wrap break-words text-slate-600">result: {JSON.stringify(t.output, null, 1)}</pre>
                </details>
              ))}
            </div>
          </Section>

          <Section title="Guardrail events">
            {allAudit.filter((a) => a.type === 'GUARDRAIL_FLAGGED').length === 0 ? (
              <p className="text-xs text-emerald-700">No guardrail violations.</p>
            ) : (
              <ul className="space-y-1 text-xs text-red-700">
                {allAudit
                  .filter((a) => a.type === 'GUARDRAIL_FLAGGED')
                  .map((a, i) => <li key={i}>{String(a.data?.category)}: &ldquo;{String(a.data?.match)}&rdquo;</li>)}
              </ul>
            )}
          </Section>

          <Section title="Audit trail (simulated)">
            <ul className="space-y-0.5 text-xs max-h-56 overflow-y-auto">
              {allAudit.length === 0 && <li className="text-slate-500">None yet.</li>}
              {allAudit.map((a, i) => (
                <li key={i} className={a.type.includes('FAILED') || a.type === 'TOOL_REJECTED' || a.type === 'GUARDRAIL_FLAGGED' ? 'text-red-700' : 'text-slate-700'}>
                  <span className="font-mono text-[10px] text-slate-400 mr-1">{a.actor}</span>
                  {a.type}
                </li>
              ))}
            </ul>
            {result && (result.sideEffects.transfers.length > 0 || result.sideEffects.contracts.length > 0 || result.sideEffects.sms.length > 0) && (
              <p className="mt-2 text-xs text-slate-500">
                Would have: {result.sideEffects.transfers.map((t) => `transferred to ${t.label}`).concat(result.sideEffects.contracts.map(() => 'texted agreement'), result.sideEffects.sms.map(() => 'sent SMS')).join(', ')}
              </p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
