import Link from 'next/link';
import { ArrowLeft, Plus, Phone, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CallStatusBadge, OutcomeBadge } from '@/components/calls/call-status-badge';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';
import type { CallStatus, MissionOutcome } from '@outbound-call/shared';

interface CallsListPageProps {
  params: Promise<{ caseId: string }>;
}

export default async function CallsListPage({ params }: CallsListPageProps) {
  const { caseId } = await params;
  const supabase = await createClient();

  const { data: calls, error } = await supabase
    .from('call_missions')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false });

  const { data: caseData } = await supabase
    .from('cases')
    .select('case_number, name, client_name')
    .eq('id', caseId)
    .single();

  const caseLabel =
    caseData?.case_number?.trim() ||
    caseData?.name?.trim() ||
    `Case ${caseId.slice(0, 8)}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/cases/${caseId}`}
            className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">AI Calls</h1>
            <p className="text-sm text-slate-500">
              {caseLabel}
              {caseData?.client_name ? ` · ${caseData.client_name}` : ''}
            </p>
          </div>
        </div>
        <Link href={`/cases/${caseId}/calls/new`}>
          <Button>
            <Plus className="h-4 w-4 mr-1.5" />
            New AI Call
          </Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          Failed to load calls. Please try again.
        </div>
      )}

      {calls && calls.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Phone className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-slate-700">No AI calls yet</h3>
            <p className="text-sm text-slate-500 mt-1">
              Create your first AI-assisted outbound call for this case.
            </p>
            <Link href={`/cases/${caseId}/calls/new`}>
              <Button className="mt-4">
                <Plus className="h-4 w-4 mr-1.5" />
                New AI Call
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {calls && calls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Call History</CardTitle>
            <p className="text-sm text-slate-500 font-normal">
              Click a row to open the call. Calls marked Awaiting Review need you to
              check the summary, transcript, and proposed updates, then mark review complete.
            </p>
          </CardHeader>
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
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {calls.map((call) => (
                  <tr key={call.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3">
                      <CallStatusBadge status={call.status as CallStatus} />
                    </td>
                    <td className="px-6 py-3">
                      <Link
                        href={`/cases/${caseId}/calls/${call.id}`}
                        className="font-medium text-navy-700 hover:text-navy-900 hover:underline"
                      >
                        {call.title}
                      </Link>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {call.mission_type.replace(/_/g, ' ')}
                      </p>
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
                      <p className="text-xs text-slate-400">
                        {format(new Date(call.created_at), 'h:mm a')}
                      </p>
                    </td>
                    <td className="px-6 py-3">
                      <Link href={`/cases/${caseId}/calls/${call.id}`}>
                        {call.status === 'awaiting_review' ? (
                          <Button size="sm">
                            Review
                            <ChevronRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline">
                            Open
                            <ChevronRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        )}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
