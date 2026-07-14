import Link from 'next/link';
import { format } from 'date-fns';
import { Phone, TrendingUp, Clock, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CallStatusBadge, OutcomeBadge } from '@/components/calls/call-status-badge';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';
import type { CallStatus, MissionOutcome } from '@outbound-call/shared';

export default async function GlobalCallsPage() {
  const supabase = await createClient();

  const { data: calls } = await supabase
    .from('call_missions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

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

      <Card>
        <CardHeader>
          <CardTitle>Recent Calls</CardTitle>
        </CardHeader>
        {allCalls.length === 0 ? (
          <CardContent>
            <div className="text-center py-8">
              <CheckCircle2 className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">No calls yet. Create one from a case.</p>
            </div>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Status</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Mission</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Destination</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Outcome</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Duration</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allCalls.map((call) => (
                  <tr key={call.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3">
                      <CallStatusBadge status={call.status as CallStatus} />
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
                      <OutcomeBadge outcome={call.outcome as MissionOutcome | null} />
                    </td>
                    <td className="px-6 py-3 text-slate-600 tabular-nums">
                      {formatDuration(call.duration_seconds)}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {format(new Date(call.created_at), 'MMM d, yyyy')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
