import Link from 'next/link';
import { format } from 'date-fns';
import { Phone, TrendingUp, Clock, CheckCircle2, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CallStatusBadge,
  OutcomeBadge,
  OutcomeReasonBadge,
} from '@/components/calls/call-status-badge';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';
import {
  MISSION_TYPE_LABELS,
  OUTCOME_REASONS,
  OUTCOME_REASON_LABELS,
  isOutcomeReason,
} from '@outbound-call/shared';
import type { CallStatus, MissionOutcome, MissionType, OutcomeReason } from '@outbound-call/shared';

interface CarrierOutcomeRow {
  carrier: string;
  missionType: string;
  total: number;
  counts: Record<OutcomeReason, number>;
}

function buildCarrierOutcomes(
  calls: Array<{ organization_name: string; mission_type: string; outcome_reason?: string | null }>,
): CarrierOutcomeRow[] {
  const rows = new Map<string, CarrierOutcomeRow>();
  for (const call of calls) {
    if (!isOutcomeReason(call.outcome_reason)) continue;
    const carrier = call.organization_name?.trim() || 'Unknown';
    const key = `${carrier.toLowerCase()}|${call.mission_type}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        carrier,
        missionType: call.mission_type,
        total: 0,
        counts: Object.fromEntries(OUTCOME_REASONS.map((r) => [r, 0])) as Record<
          OutcomeReason,
          number
        >,
      };
      rows.set(key, row);
    }
    row.total += 1;
    row.counts[call.outcome_reason] += 1;
  }
  return [...rows.values()].sort((a, b) => b.total - a.total);
}

interface CaseInfo {
  case_number: string | null;
  name: string | null;
  client_name: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
}

function clientNameFor(c: CaseInfo | null): string | null {
  if (!c) return null;
  return (
    c.client_name?.trim() ||
    [c.client_first_name, c.client_last_name].filter(Boolean).join(' ').trim() ||
    c.name?.trim() ||
    null
  );
}

const CASE_COLUMNS = 'case_number, name, client_name, client_first_name, client_last_name';

export default async function GlobalCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  // Characters that would break a PostgREST or() filter string
  const search = (q ?? '').replace(/[,()%*\\]/g, ' ').trim();
  const supabase = await createClient();

  const { data: calls } = await supabase
    .from('call_missions')
    .select(`*, cases(${CASE_COLUMNS})`)
    .order('created_at', { ascending: false })
    .limit(50);

  let tableCalls = calls ?? [];
  if (search) {
    const terms = search.split(/\s+/).filter(Boolean);
    const filters = [
      `case_number.ilike.*${search}*`,
      `name.ilike.*${search}*`,
      `client_name.ilike.*${search}*`,
      ...terms.flatMap((t) => [
        `client_first_name.ilike.*${t}*`,
        `client_last_name.ilike.*${t}*`,
      ]),
    ].join(',');

    const { data: matchingCases } = await supabase
      .from('cases')
      .select('id')
      .or(filters)
      .limit(500);

    const caseIds = (matchingCases ?? []).map((c) => c.id as string);
    if (caseIds.length === 0) {
      tableCalls = [];
    } else {
      const { data: searched } = await supabase
        .from('call_missions')
        .select(`*, cases(${CASE_COLUMNS})`)
        .in('case_id', caseIds)
        .order('created_at', { ascending: false })
        .limit(200);
      tableCalls = searched ?? [];
    }
  }

  const { data: outcomeCalls } = await supabase
    .from('call_missions')
    .select('organization_name, mission_type, outcome_reason')
    .not('outcome_reason', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1000);

  const carrierOutcomes = buildCarrierOutcomes(outcomeCalls ?? []);
  const allCalls = calls ?? [];
  const totalCalls = allCalls.length;
  const completedCalls = allCalls.filter((c) => c.status === 'completed');
  const successCalls = completedCalls.filter((c) => c.outcome === 'success');
  const awaitingReview = allCalls.filter((c) => c.status === 'awaiting_review');
  const successRate =
    completedCalls.length > 0
      ? Math.round((successCalls.length / completedCalls.length) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">AI Calls Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Overview of all AI-assisted outbound calls across all cases.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-navy-50">
                <Phone className="h-5 w-5 text-navy-700" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{totalCalls}</p>
                <p className="text-xs text-slate-500">Total Calls</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50">
                <TrendingUp className="h-5 w-5 text-emerald-700" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{successRate}%</p>
                <p className="text-xs text-slate-500">Success Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50">
                <Clock className="h-5 w-5 text-amber-700" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{awaitingReview.length}</p>
                <p className="text-xs text-slate-500">Awaiting Review</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {carrierOutcomes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Outcomes by Carrier</CardTitle>
            <p className="text-sm text-slate-500 font-normal">
              How each carrier and call type has gone with the AI caller.
            </p>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Carrier</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Call Type</th>
                  <th className="text-right px-3 py-3 font-medium text-slate-500">Calls</th>
                  {OUTCOME_REASONS.map((r) => (
                    <th key={r} className="text-right px-3 py-3 font-medium text-slate-500">
                      {OUTCOME_REASON_LABELS[r]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {carrierOutcomes.map((row) => (
                  <tr key={`${row.carrier}|${row.missionType}`}>
                    <td className="px-6 py-3 font-medium text-slate-900">{row.carrier}</td>
                    <td className="px-6 py-3 text-slate-600">
                      {MISSION_TYPE_LABELS[row.missionType as MissionType] ??
                        row.missionType.replace(/_/g, ' ')}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.total}</td>
                    {OUTCOME_REASONS.map((r) => (
                      <td
                        key={r}
                        className="px-3 py-3 text-right tabular-nums text-slate-600"
                      >
                        {row.counts[r] || '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{search ? 'Search Results' : 'Recent Calls'}</CardTitle>
            <form method="get" className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  name="q"
                  defaultValue={q ?? ''}
                  placeholder="Search client name or case number"
                  className="h-9 w-72 rounded-md border border-slate-300 bg-white pl-8 pr-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-firm-accent"
                />
              </div>
              <Button type="submit" size="sm">
                Search
              </Button>
              {search && (
                <Link href="/calls" className="text-sm text-slate-500 hover:text-slate-700">
                  Clear
                </Link>
              )}
            </form>
          </div>
        </CardHeader>
        {tableCalls.length === 0 ? (
          <CardContent>
            <div className="text-center py-8">
              <CheckCircle2 className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">
                {search
                  ? `No calls found for "${search}".`
                  : 'No calls yet. Create one from a case.'}
              </p>
            </div>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Status</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Client / Case</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Mission</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Destination</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Outcome</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Duration</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tableCalls.map((call) => {
                  const caseInfo = (call.cases ?? null) as CaseInfo | null;
                  const clientName = clientNameFor(caseInfo);
                  return (
                  <tr key={call.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3">
                      <CallStatusBadge status={call.status as CallStatus} />
                    </td>
                    <td className="px-6 py-3">
                      <Link
                        href={`/cases/${call.case_id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {clientName ?? 'Unknown client'}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {caseInfo?.case_number?.trim() || '—'}
                      </p>
                    </td>
                    <td className="px-6 py-3">
                      <Link
                        href={`/cases/${call.case_id}/calls/${call.id}`}
                        className="font-medium text-navy-700 hover:text-navy-900 hover:underline"
                      >
                        {call.title}
                      </Link>
                    </td>
                    <td className="px-6 py-3">
                      <span className="text-slate-900">{call.organization_name}</span>
                      <p className="text-xs text-slate-500 font-mono">
                        {formatPhoneNumber(call.destination_phone)}
                      </p>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <OutcomeBadge outcome={call.outcome as MissionOutcome | null} />
                        <OutcomeReasonBadge reason={call.outcome_reason} />
                      </div>
                    </td>
                    <td className="px-6 py-3 text-slate-600 tabular-nums">
                      {formatDuration(call.duration_seconds)}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {format(new Date(call.created_at), 'MMM d, yyyy')}
                    </td>
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
