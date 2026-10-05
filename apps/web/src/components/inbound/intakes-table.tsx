import Link from 'next/link';
import { format } from 'date-fns';
import { INBOUND_CASE_TYPE_LABELS, type InboundCaseType } from '@outbound-call/shared';
import { cn } from '@/lib/utils';
import { IntakeStatusBadge, QualificationBadge } from './badges';

export interface IntakeRow {
  id: string;
  call_id: string | null;
  status: string;
  caller_name: string | null;
  phone: string | null;
  language: string;
  case_type: string | null;
  qualification_result: string | null;
  high_priority: boolean;
  contract_status: string;
  created_at: string;
  line_id?: string | null;
}

/** lineNames: shown as a Line column when there is more than one line. */
export function IntakesTable({ rows, lineNames }: { rows: IntakeRow[]; lineNames?: Record<string, string> | null }) {
  if (rows.length === 0) {
    return <p className="px-6 py-8 text-center text-sm text-slate-500">No intakes yet.</p>;
  }
  const showLine = Boolean(lineNames && Object.keys(lineNames).length > 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left px-6 py-3 font-medium text-slate-500">Caller</th>
            {showLine && <th className="text-left px-6 py-3 font-medium text-slate-500">Line</th>}
            <th className="text-left px-6 py-3 font-medium text-slate-500">Case Type</th>
            <th className="text-left px-6 py-3 font-medium text-slate-500">Qualification</th>
            <th className="text-left px-6 py-3 font-medium text-slate-500">Status</th>
            <th className="text-left px-6 py-3 font-medium text-slate-500">Contract</th>
            <th className="text-left px-6 py-3 font-medium text-slate-500">Lang</th>
            <th className="text-left px-6 py-3 font-medium text-slate-500">Received</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const urgent = r.high_priority || r.qualification_result === 'high_priority';
            return (
              <tr key={r.id} className={cn('hover:bg-slate-50 transition-colors', urgent && 'bg-red-50/60 border-l-4 border-l-red-500')}>
                <td className="px-6 py-3">
                  <Link href={r.call_id ? `/inbound/calls/${r.call_id}` : '#'} className="font-medium text-slate-900 hover:underline">
                    {r.caller_name ?? 'Unknown caller'}
                  </Link>
                  <p className="text-xs text-slate-500 font-mono">{r.phone ?? '—'}</p>
                </td>
                {showLine && <td className="px-6 py-3 text-slate-700">{(r.line_id && lineNames?.[r.line_id]) ?? '—'}</td>}
                <td className="px-6 py-3 text-slate-700">
                  {r.case_type ? INBOUND_CASE_TYPE_LABELS[r.case_type as InboundCaseType] ?? r.case_type : '—'}
                </td>
                <td className="px-6 py-3">
                  <QualificationBadge result={r.qualification_result} />
                </td>
                <td className="px-6 py-3">
                  <IntakeStatusBadge status={r.status} />
                </td>
                <td className="px-6 py-3 text-slate-600 capitalize">{r.contract_status === 'none' ? '—' : r.contract_status}</td>
                <td className="px-6 py-3 text-slate-600 uppercase">{r.language}</td>
                <td className="px-6 py-3 text-slate-600">{format(new Date(r.created_at), 'MMM d, h:mm a')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
