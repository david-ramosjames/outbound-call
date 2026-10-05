import Link from 'next/link';
import { format, startOfDay } from 'date-fns';
import { AlertTriangle, PhoneCall } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InboundPageHeader } from '@/components/inbound/page-header';
import { IntakesTable, type IntakeRow } from '@/components/inbound/intakes-table';
import { resolveInboundConfig } from '@outbound-call/shared';

export const dynamic = 'force-dynamic';

export default async function InboundDashboardPage() {
  const supabase = await createClient();
  const todayIso = startOfDay(new Date()).toISOString();

  const [{ data: settings, error: settingsError }, { data: callsToday }, { data: intakesToday }, { data: recent }, { data: callbacks }, { data: live }] =
    await Promise.all([
      supabase.from('inbound_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('inbound_calls').select('id, status').gte('started_at', todayIso).eq('simulated', false),
      supabase
        .from('inbound_intakes')
        .select('id, status, caller_type, qualification_result, contract_status, high_priority')
        .gte('created_at', todayIso),
      supabase
        .from('inbound_intakes')
        .select('id, call_id, status, caller_name, phone, language, case_type, qualification_result, high_priority, contract_status, created_at')
        .order('created_at', { ascending: false })
        .limit(15),
      supabase
        .from('inbound_callback_requests')
        .select('id, intake_id, call_id, priority, reason, phone, preferred_time, created_at')
        .eq('status', 'open')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.from('inbound_calls').select('id, from_number, started_at, status').in('status', ['ringing', 'in_progress', 'transferring']).limit(10),
    ]);

  const { data: lineRows, error: linesError } = await supabase.from('inbound_lines').select('*').eq('active', true).order('name');
  const lineConfigs = linesError ? [resolveInboundConfig(settings)] : (lineRows ?? []).map((r) => resolveInboundConfig(r));
  const offLines = lineConfigs.filter((c) => !c.flags.inbound_enabled || !c.flags.inbound_voice_enabled);
  const cfg = offLines[0] ?? lineConfigs[0] ?? resolveInboundConfig(settings);
  const intakes = intakesToday ?? [];
  const metrics = [
    { label: 'Calls Today', value: (callsToday ?? []).length },
    { label: 'New Leads', value: intakes.filter((i) => i.caller_type === 'new_potential_client').length },
    { label: 'Qualified', value: intakes.filter((i) => i.qualification_result === 'qualified' || i.qualification_result === 'high_priority').length },
    { label: 'Needs Review', value: intakes.filter((i) => i.status === 'needs_review').length },
    { label: 'Contracts Sent', value: intakes.filter((i) => i.contract_status === 'sent' || i.contract_status === 'signed').length },
    { label: 'Contracts Signed', value: intakes.filter((i) => i.contract_status === 'signed').length },
    { label: 'Transfers', value: intakes.filter((i) => i.status === 'transferred').length },
    { label: 'Missed / Incomplete', value: intakes.filter((i) => i.status === 'incomplete').length },
  ];
  const highPriorityToday = intakes.filter((i) => i.high_priority || i.qualification_result === 'high_priority').length;

  return (
    <div className="space-y-6">
      <InboundPageHeader title="Dashboard" description="Inbound calls answered by the AI intake agent." />

      {settingsError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Inbound tables are not available yet. Run the inbound intake migration in Supabase first.
        </div>
      )}
      {!settingsError && offLines.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          The inbound AI is <strong>off</strong>
          {linesError ? '' : ` for ${offLines.map((c) => c.firm_name).join(', ')}`}. Calls to {offLines.length > 1 ? 'those lines' : 'that line'} use
          fallback routing ({cfg.routing.disabled_behavior === 'forward_to_primary' ? 'forwarded to the primary number' : 'a recorded message'}).
          Turn it on in <Link href="/inbound/settings" className="underline">Settings</Link> after testing with the{' '}
          <Link href="/inbound/test" className="underline">Test Agent</Link>.
        </div>
      )}

      {(live ?? []).length > 0 && (
        <Card className="border-red-200">
          <CardContent className="pt-4 flex flex-wrap items-center gap-3">
            <PhoneCall className="h-5 w-5 text-red-600" />
            <span className="text-sm font-medium text-slate-900">Live now:</span>
            {(live ?? []).map((c) => (
              <Link key={c.id} href={`/inbound/calls/${c.id}`} className="text-sm text-navy-700 hover:underline">
                {c.from_number ?? 'Unknown caller'} ({c.status.replace('_', ' ')}, since {format(new Date(c.started_at), 'h:mm a')})
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {highPriorityToday > 0 && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <p className="text-sm font-semibold text-red-800">
            {highPriorityToday} high-priority lead{highPriorityToday === 1 ? '' : 's'} today.{' '}
            <Link href="/inbound/intakes?filter=high_priority" className="underline">Review now</Link>
          </p>
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-5">
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{m.value}</p>
              <p className="text-xs text-slate-500">{m.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {(callbacks ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open Callback Requests</CardTitle>
          </CardHeader>
          <div className="divide-y divide-slate-100">
            {(callbacks ?? []).map((cb) => (
              <Link
                key={cb.id}
                href={cb.call_id ? `/inbound/calls/${cb.call_id}` : '/inbound/intakes'}
                className="flex items-center gap-3 px-6 py-3 hover:bg-slate-50"
              >
                <span
                  className={
                    cb.priority === 'urgent'
                      ? 'text-xs font-semibold rounded-full px-2 py-0.5 bg-red-100 text-red-700'
                      : 'text-xs rounded-full px-2 py-0.5 bg-slate-100 text-slate-600'
                  }
                >
                  {cb.priority === 'urgent' ? 'URGENT' : 'Normal'}
                </span>
                <span className="text-sm text-slate-900 flex-1 truncate">{cb.reason}</span>
                <span className="text-xs text-slate-500 font-mono">{cb.phone ?? ''}</span>
                <span className="text-xs text-slate-400">{format(new Date(cb.created_at), 'MMM d, h:mm a')}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Intakes</CardTitle>
            <Link href="/inbound/intakes" className="text-sm text-navy-700 hover:underline">
              View all
            </Link>
          </div>
        </CardHeader>
        <IntakesTable rows={(recent ?? []) as IntakeRow[]} />
      </Card>
    </div>
  );
}
