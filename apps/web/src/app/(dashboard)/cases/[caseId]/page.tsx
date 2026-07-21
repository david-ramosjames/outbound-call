import Link from 'next/link';
import { ArrowLeft, Phone, FileText, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface CaseDetailPageProps {
  params: Promise<{ caseId: string }>;
}

export default async function CaseDetailPage({ params }: CaseDetailPageProps) {
  const { caseId } = await params;
  const supabase = await createClient();

  const { data: caseData } = await supabase
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .single();

  const { data: recentCalls } = await supabase
    .from('call_missions')
    .select('id, title, status, outcome, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(5);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/cases"
            className="p-2 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 truncate">
              {caseData?.case_number?.trim() ||
                caseData?.name?.trim() ||
                'Case Details'}
            </h1>
            <p className="text-sm text-slate-500">
              {caseData?.client_name
                ? `${caseData.client_name}${caseData.case_type ? ` · ${caseData.case_type}` : ''}`
                : caseData?.case_type ?? 'Case details'}
            </p>
          </div>
        </div>
        <Link href={`/cases/${caseId}/calls/new`} className="shrink-0">
          <Button>
            <Phone className="h-4 w-4 mr-1.5" />
            New AI Call
          </Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Case Information</CardTitle>
            </CardHeader>
            <CardContent>
              {caseData ? (
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-slate-500">Case Number</dt>
                    <dd className="font-medium mt-0.5">
                      {caseData.case_number?.trim() || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Status</dt>
                    <dd className="font-medium mt-0.5">
                      <Badge>{caseData.status ?? 'Active'}</Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Type</dt>
                    <dd className="font-medium mt-0.5">{caseData.case_type ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Client</dt>
                    <dd className="font-medium mt-0.5">{caseData.client_name ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Created</dt>
                    <dd className="font-medium mt-0.5">{caseData.created_at ?? '—'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-slate-500">Case data not found.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  AI Calls
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Link href={`/cases/${caseId}/calls`}>
                    <Button size="sm" variant="outline">View All</Button>
                  </Link>
                  <Link href={`/cases/${caseId}/calls/new`}>
                    <Button size="sm">
                      <Phone className="h-3.5 w-3.5 mr-1" />
                      New
                    </Button>
                  </Link>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {recentCalls && recentCalls.length > 0 ? (
                <div className="space-y-3">
                  {recentCalls.map((call) => (
                    <Link
                      key={call.id}
                      href={`/cases/${caseId}/calls/${call.id}`}
                      className="block p-3 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-900 truncate">
                          {call.title}
                        </span>
                        <Badge variant={call.status === 'completed' ? 'success' : 'secondary'}>
                          {call.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                        <Clock className="h-3 w-3" />
                        {new Date(call.created_at).toLocaleDateString()}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No AI calls yet</p>
                  <Link href={`/cases/${caseId}/calls/new`}>
                    <Button size="sm" className="mt-3">
                      <Phone className="h-3.5 w-3.5 mr-1.5" />
                      New AI Call
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
