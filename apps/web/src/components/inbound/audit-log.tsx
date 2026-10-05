'use client';

import { format } from 'date-fns';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ClipboardEdit,
  Eye,
  FileSignature,
  Flag,
  Languages,
  MessageSquare,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  Scale,
  ShieldAlert,
  Siren,
  type LucideIcon,
} from 'lucide-react';
import { INTAKE_FACT_LABELS, QUALIFICATION_RESULT_LABELS, type IntakeFactKey, type QualificationResultValue } from '@outbound-call/shared';
import { cn } from '@/lib/utils';

export interface AuditRow {
  id: number;
  event_type: string;
  actor: string;
  event_data: Record<string, unknown>;
  created_at: string;
}

type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'bad';

interface Described {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  detail?: string | null;
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  info: 'bg-navy-50 text-navy-700',
  good: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-red-50 text-red-700',
};

const ACTOR_LABELS: Record<string, string> = { AI: 'AI', SYSTEM: 'System', ADMIN: 'Staff', HUMAN: 'Staff' };

const BUSINESS_LABELS: Record<string, string> = {
  business_hours: 'during business hours',
  after_hours: 'after hours',
  closed: 'while the office was closed',
};

const DELIVERY_LABELS: Record<string, string> = { sms: 'by text', email: 'by email' };

const TOOL_LABELS: Record<string, string> = {
  transfer_to_human: 'Transfer',
  send_engagement_agreement: 'Send agreement',
  resend_engagement_agreement: 'Resend agreement',
  send_sms: 'Text message',
  request_callback: 'Callback request',
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function humanize(s: string): string {
  const t = s.replace(/^case_specific\./, '').replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function fieldLabel(key: string): string {
  return INTAKE_FACT_LABELS[key as IntakeFactKey] ?? humanize(key);
}

function qualificationLabel(v: unknown): string {
  return QUALIFICATION_RESULT_LABELS[v as QualificationResultValue] ?? (str(v) ? humanize(String(v)) : 'Unknown');
}

function joinParts(...parts: Array<string | null | undefined | false>): string | null {
  const p = parts.filter(Boolean) as string[];
  return p.length ? p.join(' · ') : null;
}

function describe(type: string, d: Record<string, unknown>): Described {
  switch (type) {
    case 'CALL_STARTED':
      return {
        icon: PhoneCall,
        tone: 'info',
        title: `Call answered ${BUSINESS_LABELS[String(d.business_status)] ?? ''}`.trim(),
        detail: joinParts(str(d.line) && `Line: ${d.line}`, str(d.forwarded_from) && `Forwarded from ${d.forwarded_from}`),
      };
    case 'INTAKE_UPDATED': {
      if (str(d.declined)) return { icon: Ban, tone: 'neutral', title: `Caller declined to answer: ${fieldLabel(String(d.declined))}` };
      const fields = Array.isArray(d.fields) ? (d.fields as string[]) : [];
      return { icon: ClipboardEdit, tone: 'neutral', title: `Collected ${fields.map(fieldLabel).join(', ') || 'details'}` };
    }
    case 'LANGUAGE_CHANGED':
      return { icon: Languages, tone: 'info', title: `Switched to ${d.to === 'es' ? 'Spanish' : 'English'}` };
    case 'QUALIFICATION_RUN':
    case 'QUALIFICATION_CHANGED':
      return {
        icon: Scale,
        tone: d.result === 'high_priority' || d.result === 'qualified' ? 'good' : d.result === 'not_qualified' ? 'warn' : 'info',
        title: `Qualification: ${qualificationLabel(d.result)}`,
        detail: Array.isArray(d.reasons) ? (d.reasons as string[]).join('; ') : null,
      };
    case 'HIGH_PRIORITY_DETECTED':
      return {
        icon: Siren,
        tone: 'bad',
        title: 'Marked high priority',
        detail: Array.isArray(d.indicators) ? (d.indicators as string[]).map(humanize).join(', ') : str(d.reason),
      };
    case 'NEEDS_REVIEW_MARKED':
      return { icon: Flag, tone: 'warn', title: 'Flagged for staff review', detail: str(d.reason) };
    case 'TRANSFER_ATTEMPTED':
      return { icon: PhoneForwarded, tone: 'info', title: `Transferring to ${str(d.target) ?? 'staff'}`, detail: str(d.reason) };
    case 'TRANSFER_SUCCEEDED':
      return { icon: CheckCircle2, tone: 'good', title: `Transfer connected to ${str(d.target) ?? 'staff'}` };
    case 'TRANSFER_FAILED':
      if (d.leg === 'ai') {
        return { icon: PhoneOff, tone: 'bad', title: 'AI could not take the call', detail: joinParts(str(d.dial_status) && `Status: ${d.dial_status}`, 'Fallback routing used') };
      }
      return {
        icon: PhoneOff,
        tone: 'bad',
        title: `Transfer to ${str(d.target) ?? 'staff'} did not connect`,
        detail: str(d.error) ?? (str(d.dial_status) && `Status: ${humanize(String(d.dial_status))}`),
      };
    case 'CONTRACT_OFFERED':
      return { icon: FileSignature, tone: 'info', title: `Caller agreed to receive the agreement ${DELIVERY_LABELS[String(d.delivery)] ?? ''}`.trim() };
    case 'CONTRACT_SENT':
      return { icon: FileSignature, tone: 'good', title: `Agreement sent ${DELIVERY_LABELS[String(d.delivery)] ?? ''}`.trim(), detail: str(d.provider) && `Via ${humanize(String(d.provider))}` };
    case 'CONTRACT_RESENT':
      return { icon: FileSignature, tone: 'info', title: `Agreement resent ${DELIVERY_LABELS[String(d.delivery)] ?? ''}`.trim() };
    case 'CONTRACT_SEND_FAILED':
      return { icon: AlertTriangle, tone: 'bad', title: d.resend ? 'Agreement resend failed' : 'Agreement could not be sent', detail: str(d.error) };
    case 'CONTRACT_VIEWED':
      return { icon: Eye, tone: 'info', title: 'Caller opened the agreement' };
    case 'CONTRACT_SIGNED':
      return { icon: CheckCircle2, tone: 'good', title: 'Agreement signed' };
    case 'CONTRACT_DECLINED':
      return { icon: Ban, tone: 'warn', title: `Agreement ${str(d.status) ? humanize(String(d.status)).toLowerCase() : 'declined'}` };
    case 'CALLBACK_REQUESTED':
      return {
        icon: PhoneCall,
        tone: d.priority === 'urgent' ? 'bad' : 'info',
        title: d.priority === 'urgent' ? 'Urgent callback requested' : 'Callback requested',
        detail: joinParts(str(d.reason), str(d.preferred_time) && `Best time: ${d.preferred_time}`),
      };
    case 'SMS_SENT':
      return { icon: MessageSquare, tone: 'good', title: `Text sent${str(d.template) ? `: ${humanize(String(d.template)).toLowerCase()}` : ''}` };
    case 'SMS_FAILED':
      return { icon: MessageSquare, tone: 'bad', title: 'Text message failed', detail: str(d.error) };
    case 'GUARDRAIL_FLAGGED': {
      const violations = Array.isArray(d.violations) ? (d.violations as Array<{ category?: string }>) : d.category ? [d as { category?: string }] : [];
      return {
        icon: ShieldAlert,
        tone: 'bad',
        title: 'AI said something it should not',
        detail: joinParts(violations.map((v) => humanize(String(v.category ?? 'rule'))).join(', '), str(d.text) && `“${d.text}”`),
      };
    }
    case 'TOOL_REJECTED':
      return {
        icon: Ban,
        tone: 'warn',
        title: `${TOOL_LABELS[String(d.tool)] ?? humanize(String(d.tool ?? 'Action'))} not allowed`,
        detail: str(d.error),
      };
    case 'INTAKE_COMPLETED':
      return { icon: CheckCircle2, tone: 'good', title: 'Intake completed', detail: str(d.note) };
    case 'CALL_COMPLETED': {
      const secs = typeof d.duration_seconds === 'number' ? d.duration_seconds : null;
      return {
        icon: PhoneOff,
        tone: 'neutral',
        title: 'Call ended',
        detail: joinParts(str(d.reason) && humanize(String(d.reason)), secs !== null && `${Math.floor(secs / 60)}m ${secs % 60}s`),
      };
    }
    default:
      return { icon: ClipboardEdit, tone: 'neutral', title: humanize(type.toLowerCase()) };
  }
}

/** Consecutive "collected" updates from the AI collapse into one row. */
function groupEvents(events: AuditRow[]): AuditRow[] {
  const out: AuditRow[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    const isFields = e.event_type === 'INTAKE_UPDATED' && Array.isArray(e.event_data?.fields);
    if (isFields && prev && prev.event_type === 'INTAKE_UPDATED' && Array.isArray(prev.event_data?.fields)) {
      const merged = [...(prev.event_data.fields as string[])];
      for (const f of e.event_data.fields as string[]) if (!merged.includes(f)) merged.push(f);
      out[out.length - 1] = { ...prev, event_data: { fields: merged } };
      continue;
    }
    out.push(e);
  }
  return out;
}

export function AuditLog({ events }: { events: AuditRow[] }) {
  if (events.length === 0) return <p className="px-6 py-4 text-sm text-slate-500">No events yet.</p>;
  const rows = groupEvents(events);
  return (
    <ol className="px-6 py-4">
      {rows.map((e, i) => {
        const d = describe(e.event_type, e.event_data ?? {});
        const Icon = d.icon;
        const last = i === rows.length - 1;
        return (
          <li key={e.id} className="relative flex gap-3 pb-4">
            {!last && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-slate-200" aria-hidden />}
            <span className={cn('relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', TONE_CLASSES[d.tone])}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className={cn('text-sm font-medium', d.tone === 'bad' ? 'text-red-700' : 'text-slate-900')}>{d.title}</p>
                <span className="text-xs text-slate-400">
                  {format(new Date(e.created_at), 'h:mm:ss a')} · {ACTOR_LABELS[e.actor] ?? e.actor}
                </span>
              </div>
              {d.detail && <p className="text-xs text-slate-600 mt-0.5 break-words">{d.detail}</p>}
              {Object.keys(e.event_data ?? {}).length > 0 && (
                <details className="mt-0.5">
                  <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">Details</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-[11px] text-slate-600">
                    {JSON.stringify(e.event_data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
