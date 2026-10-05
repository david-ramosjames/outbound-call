import Link from 'next/link';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { InboundPageHeader } from '@/components/inbound/page-header';
import { InboundCallStatusBadge, QualificationBadge } from '@/components/inbound/badges';
import { loadLineNames } from '@/lib/inbound-line-names';
import { formatDuration } from '@/lib/utils';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface CallRow {
  id: string;
  from_number: string | null;
  status: string;
  language: string;
  business_status: string | null;
  transfer_status: string | null;
  end_reason: string | null;
  started_at: string;
  duration_seconds: number | null;
  line_id?: string | null;
  inbound_intakes: Array<{ caller_name: string | null; qualification_result: string | null; high_priority: boolean; case_type: string | null }>;
}

export default async function InboundCallsPage() {
  const supabase = await createClient();
  const lineNames = await loadLineNames(supabase);
  const showLine = Boolean(lineNames && Object.keys(lineNames).length > 1);
  const { data, error } = await supabase
    .from('inbound_calls')
    .select(
      `id, from_number, status, language, business_status, transfer_status, end_reason, started_at, duration_seconds, inbound_intakes(caller_name, qualification_result, high_priority, case_type)${lineNames ? ', line_id' : ''}`,
    )
    .eq('simulated', false)
    .order('started_at', { ascending: false })
    .limit(100);

  const rows = (data ?? []) as unknown as CallRow[];

  return (
    <div className="space-y-6">
      <InboundPageHeader title="Calls" description="Every inbound call that reached the AI. Open a live call to watch it in real time." />
      <Card>
        {error ? (
          <p className="px-6 py-8 text-sm text-red-600">Could not load calls: {error.message}</p>
        ) : rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">No inbound calls yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Status</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Caller</th>
                  {showLine && <th className="text-left px-6 py-3 font-medium text-slate-500">Line</th>}
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Qualification</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Office</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Transfer</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Duration</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => {
                  const intake = c.inbound_intakes?.[0];
                  const urgent = intake?.high_priority || intake?.qualification_result === 'high_priority';
                  return (
                    <tr key={c.id} className={cn('hover:bg-slate-50', urgent && 'bg-red-50/60')}>
                      <td className="px-6 py-3">
                        <InboundCallStatusBadge status={c.status} />
                      </td>
                      <td className="px-6 py-3">
                        <Link href={`/inbound/calls/${c.id}`} className="font-medium text-navy-700 hover:underline">
                          {intake?.caller_name ?? 'Unknown caller'}
                        </Link>
                        <p className="text-xs text-slate-500 font-mono">{c.from_number ?? '—'}</p>
                      </td>
                      {showLine && <td className="px-6 py-3 text-slate-700">{(c.line_id && lineNames?.[c.line_id]) ?? '—'}</td>}
                      <td className="px-6 py-3">
                        <QualificationBadge result={intake?.qualification_result} />
                      </td>
                      <td className="px-6 py-3 text-slate-600">{c.business_status?.replace('_', ' ') ?? '—'}</td>
                      <td className="px-6 py-3 text-slate-600">{c.transfer_status ?? '—'}</td>
                      <td className="px-6 py-3 text-slate-600 tabular-nums">{formatDuration(c.duration_seconds)}</td>
                      <td className="px-6 py-3 text-slate-600">{format(new Date(c.started_at), 'MMM d, h:mm a')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
