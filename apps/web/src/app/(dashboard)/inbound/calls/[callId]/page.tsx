'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import {
  currentIntakeStage,
  getMissingFields,
  INBOUND_INTAKE_STATUSES,
  INTAKE_FACT_LABELS,
  resolveInboundConfig,
  type IntakeFactKey,
  type IntakeFacts,
} from '@outbound-call/shared';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { InboundCallStatusBadge, IntakeStatusBadge, QualificationBadge } from '@/components/inbound/badges';
import { LoadingSpinner, selectClass } from '@/components/inbound/page-header';
import { cn, formatDuration } from '@/lib/utils';

interface CallData {
  id: string;
  from_number: string | null;
  to_number: string | null;
  status: string;
  language: string;
  business_status: string | null;
  transfer_status: string | null;
  transferred_to: string | null;
  end_reason: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  line_id?: string | null;
}

interface IntakeData {
  id: string;
  status: string;
  qualification_result: string | null;
  qualification_reasons: string[];
  high_priority: boolean;
  high_priority_reasons: string[];
  needs_review_reasons: string[];
  recommended_next_action: string | null;
  can_send_contract: boolean;
  contract_status: string;
  facts: IntakeFacts;
  summary: string | null;
  staff_notes: string | null;
  reviewed_at: string | null;
}

interface Segment { id: number; speaker: string; text: string; created_at: string }
interface AuditRow { id: number; event_type: string; actor: string; event_data: Record<string, unknown>; created_at: string }
interface CallbackRow { id: string; priority: string; reason: string; phone: string | null; preferred_time: string | null; status: string; created_at: string }

const LIVE_STATUSES = ['ringing', 'in_progress', 'transferring'];

function factValue(v: unknown): string {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (Array.isArray(v)) return v.join(', ');
  if (v && typeof v === 'object') return Object.entries(v).map(([k, val]) => `${k}: ${val}`).join('; ');
  return String(v);
}

export default function InboundCallDetailPage() {
  const { callId } = useParams<{ callId: string }>();
  const [call, setCall] = useState<CallData | null>(null);
  const [intake, setIntake] = useState<IntakeData | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [callbacks, setCallbacks] = useState<CallbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [lineName, setLineName] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [c, i, s, a, cb] = await Promise.all([
      supabase.from('inbound_calls').select('*').eq('id', callId).maybeSingle(),
      supabase.from('inbound_intakes').select('*').eq('call_id', callId).order('created_at').limit(1).maybeSingle(),
      supabase.from('inbound_transcript_segments').select('id, speaker, text, created_at').eq('call_id', callId).order('id'),
      supabase.from('inbound_audit_events').select('id, event_type, actor, event_data, created_at').eq('call_id', callId).order('id'),
      supabase.from('inbound_callback_requests').select('*').eq('call_id', callId).order('created_at'),
    ]);
    const callLineId = (c.data as CallData | null)?.line_id;
    const settings = callLineId
      ? await supabase.from('inbound_lines').select('name, flags').eq('id', callLineId).maybeSingle()
      : await supabase.from('inbound_settings').select('flags').eq('id', 1).maybeSingle();
    const resolved = resolveInboundConfig(settings.data);
    setLiveEnabled(resolved.flags.live_dashboard_enabled);
    setLineName(callLineId ? resolved.firm_name : null);
    setCall(c.data as CallData | null);
    setIntake((prev) => {
      const next = i.data as IntakeData | null;
      if (!prev && next) setNotes(next.staff_notes ?? '');
      return next;
    });
    setSegments((s.data ?? []) as Segment[]);
    setAudit((a.data ?? []) as AuditRow[]);
    setCallbacks((cb.data ?? []) as CallbackRow[]);
    setLoading(false);
  }, [callId]);

  const isLive = call ? LIVE_STATUSES.includes(call.status) : false;

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isLive || !liveEnabled) return;
    const poll = setInterval(() => void load(), 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [isLive, liveEnabled, load]);

  const facts = intake?.facts ?? {};
  const stage = useMemo(() => currentIntakeStage(facts, new Date()), [facts]);
  const missing = useMemo(() => getMissingFields(facts, new Date()), [facts]);

  const patchIntake = async (patch: Record<string, unknown>) => {
    if (!intake) return;
    setSaving(true);
    await fetch(`/api/inbound/intakes/${intake.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    await load();
  };

  const setCallbackStatus = async (id: string, status: 'open' | 'done') => {
    await fetch(`/api/inbound/callbacks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    await load();
  };

  if (loading) return <LoadingSpinner />;
  if (!call) return <p className="text-slate-500">Call not found.</p>;

  const duration = isLive
    ? Math.round((now - Date.parse(call.answered_at ?? call.started_at)) / 1000)
    : call.duration_seconds;
  const urgent = intake?.high_priority || intake?.qualification_result === 'high_priority';
  const factEntries = Object.entries(facts).filter(([k, v]) => v !== null && v !== undefined && k !== 'declined_to_provide');

  return (
    <div className="space-y-6">
      <Link href="/inbound/calls" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4 mr-1" /> All inbound calls
      </Link>

      <div className={cn('rounded-xl border bg-white p-5 shadow-sm', urgent ? 'border-red-300 border-2' : 'border-slate-200')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{facts.caller_name ?? 'Unknown caller'}</h1>
            <p className="text-sm text-slate-500 font-mono">{facts.phone ?? call.from_number ?? '—'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <InboundCallStatusBadge status={call.status} />
            <QualificationBadge result={intake?.qualification_result} />
            {intake && <IntakeStatusBadge status={intake.status} />}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500">Duration</p>
            <p className="font-medium tabular-nums">{formatDuration(duration ?? null)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Language</p>
            <p className="font-medium">{call.language === 'es' ? 'Spanish' : 'English'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Intake stage</p>
            <p className="font-medium capitalize">{stage.replace(/_/g, ' ')}</p>
          </div>
          {lineName && (
            <div>
              <p className="text-xs text-slate-500">Line</p>
              <p className="font-medium">{lineName}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-slate-500">Office</p>
            <p className="font-medium capitalize">{call.business_status?.replace('_', ' ') ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Started</p>
            <p className="font-medium">{format(new Date(call.started_at), 'MMM d, h:mm a')}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-6">
          {intake?.summary && (
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800">{intake.summary}</pre>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{isLive ? 'Live Transcript' : 'Transcript'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[560px] overflow-y-auto">
              {segments.length === 0 && <p className="text-sm text-slate-500">No transcript yet.</p>}
              {segments.map((s) => (
                <div key={s.id} className={cn('flex', s.speaker === 'agent' ? 'justify-start' : 'justify-end')}>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                      s.speaker === 'agent' ? 'bg-navy-50 text-slate-900' : 'bg-slate-100 text-slate-900',
                    )}
                  >
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                      {s.speaker === 'agent' ? 'AI' : 'Caller'} · {format(new Date(s.created_at), 'h:mm:ss a')}
                    </p>
                    {s.text}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actions &amp; Audit Log</CardTitle>
            </CardHeader>
            <div className="divide-y divide-slate-100">
              {audit.length === 0 && <p className="px-6 py-4 text-sm text-slate-500">No events.</p>}
              {audit.map((e) => (
                <div key={e.id} className="px-6 py-2.5 text-sm flex gap-3">
                  <span className="text-xs text-slate-400 w-20 shrink-0">{format(new Date(e.created_at), 'h:mm:ss a')}</span>
                  <span className="text-[10px] font-semibold rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 h-fit">{e.actor}</span>
                  <div className="min-w-0">
                    <p className={cn('font-medium', e.event_type.includes('FAILED') || e.event_type === 'GUARDRAIL_FLAGGED' ? 'text-red-700' : 'text-slate-900')}>
                      {e.event_type}
                    </p>
                    {Object.keys(e.event_data ?? {}).length > 0 && (
                      <p className="text-xs text-slate-500 break-words">{JSON.stringify(e.event_data)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Qualification</CardTitle>
              <p className="text-xs text-slate-500">Internal only. Never shared with the caller.</p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <QualificationBadge result={intake?.qualification_result} />
              {(intake?.qualification_reasons ?? []).length > 0 && (
                <ul className="list-disc pl-5 text-slate-700 space-y-1">
                  {intake!.qualification_reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              )}
              {(intake?.high_priority_reasons ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-700">Urgent indicators</p>
                  <p className="text-slate-700">{intake!.high_priority_reasons.join(', ')}</p>
                </div>
              )}
              {(intake?.needs_review_reasons ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-700">Review flags</p>
                  <p className="text-slate-700">{intake!.needs_review_reasons.join('; ')}</p>
                </div>
              )}
              <p className="text-xs text-slate-500">
                Contract eligible: {intake?.can_send_contract ? 'yes' : 'no'} · Contract: {intake?.contract_status ?? 'none'} · Next step: {intake?.recommended_next_action?.replace(/_/g, ' ') ?? '—'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Facts Collected</CardTitle>
            </CardHeader>
            <CardContent>
              {factEntries.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing collected yet.</p>
              ) : (
                <dl className="space-y-1.5 text-sm">
                  {factEntries.map(([k, v]) => (
                    <div key={k} className="grid grid-cols-5 gap-2">
                      <dt className="col-span-2 text-slate-500">{INTAKE_FACT_LABELS[k as IntakeFactKey] ?? k.replace(/_/g, ' ')}</dt>
                      <dd className="col-span-3 text-slate-900 break-words">{factValue(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Missing Information</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {missing.missing.length === 0 ? (
                <p className="text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> Nothing missing</p>
              ) : (
                <ul className="list-disc pl-5 text-slate-700 space-y-0.5">
                  {missing.missing.map((m) => <li key={m.key}>{m.label}</li>)}
                </ul>
              )}
              {missing.declined.length > 0 && <p className="mt-2 text-xs text-slate-500">Declined: {missing.declined.join(', ')}</p>}
            </CardContent>
          </Card>

          {callbacks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Callback Requests</CardTitle>
              </CardHeader>
              <div className="divide-y divide-slate-100">
                {callbacks.map((cb) => (
                  <div key={cb.id} className="px-6 py-3 text-sm space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cb.priority === 'urgent' ? 'text-xs font-semibold text-red-700' : 'text-xs text-slate-500'}>
                        {cb.priority.toUpperCase()}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => setCallbackStatus(cb.id, cb.status === 'done' ? 'open' : 'done')}>
                        {cb.status === 'done' ? 'Reopen' : 'Mark done'}
                      </Button>
                    </div>
                    <p className={cn('text-slate-900', cb.status === 'done' && 'line-through text-slate-400')}>{cb.reason}</p>
                    <p className="text-xs text-slate-500">{[cb.phone, cb.preferred_time].filter(Boolean).join(' · ')}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {intake && (
            <Card>
              <CardHeader>
                <CardTitle>Staff Review</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="intake-status" className="block text-sm font-medium text-slate-700">Status</label>
                  <select
                    id="intake-status"
                    className={selectClass}
                    value={intake.status}
                    onChange={(e) => void patchIntake({ status: e.target.value })}
                    disabled={saving}
                  >
                    {INBOUND_INTAKE_STATUSES.map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <Textarea id="staff-notes" label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => void patchIntake({ staff_notes: notes, reviewed: true })} disabled={saving}>
                    {saving ? 'Saving...' : 'Save & mark reviewed'}
                  </Button>
                  {intake.reviewed_at && (
                    <span className="text-xs text-slate-500">Reviewed {format(new Date(intake.reviewed_at), 'MMM d, h:mm a')}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
