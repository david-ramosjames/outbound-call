'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, User, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CallStatusBadge, OutcomeBadge } from '@/components/calls/call-status-badge';
import { TranscriptViewer } from '@/components/calls/transcript-viewer';
import { ResultFieldReview } from '@/components/calls/result-field-review';
import { ProposedUpdateCard } from '@/components/calls/proposed-update-card';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type {
  CallStatus,
  MissionOutcome,
  TranscriptSegment,
  ReviewStatus,
} from '@outbound-call/shared';

type Tab = 'overview' | 'summary' | 'updates' | 'transcript';

interface CallMission {
  id: string;
  case_id: string;
  title: string;
  mission_type: string;
  organization_name: string;
  department: string | null;
  contact_name: string | null;
  destination_phone: string;
  extension: string | null;
  destination_timezone: string;
  goal: string;
  status: CallStatus;
  outcome: MissionOutcome | null;
  created_by: string;
  authorized_by: string | null;
  authorized_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  failure_reason: string | null;
  created_at: string;
}

interface CallResultField {
  id: string;
  field_key: string;
  field_label: string;
  extracted_value: unknown;
  confidence: number;
  evidence_segment_ids: string[];
  review_status: ReviewStatus;
  reviewed_value: unknown;
}

interface ProposedUpdate {
  id: string;
  target_field: string;
  current_value: unknown;
  proposed_value: unknown;
  reason: string;
  review_status: ReviewStatus;
  reviewed_value: unknown;
}

export default function MissionDetailPage() {
  const params = useParams<{ caseId: string; missionId: string }>();
  const { caseId, missionId } = params;

  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [mission, setMission] = useState<CallMission | null>(null);
  const [resultFields, setResultFields] = useState<CallResultField[]>([]);
  const [proposedUpdates, setProposedUpdates] = useState<ProposedUpdate[]>([]);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [highlightedSegments, setHighlightedSegments] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    const supabase = createClient();

    const { data: missionData } = await supabase
      .from('call_missions')
      .select('*')
      .eq('id', missionId)
      .single();

    if (missionData) setMission(missionData as CallMission);

    const { data: resultData } = await supabase
      .from('call_results')
      .select('*')
      .eq('call_mission_id', missionId)
      .single();

    if (resultData) {
      setSummary(resultData.summary ?? '');

      const { data: fields } = await supabase
        .from('call_result_fields')
        .select('*')
        .eq('call_result_id', resultData.id)
        .order('created_at');

      if (fields) setResultFields(fields as CallResultField[]);
    }

    const { data: updates } = await supabase
      .from('call_proposed_updates')
      .select('*')
      .eq('call_mission_id', missionId)
      .order('created_at');

    if (updates) setProposedUpdates(updates as ProposedUpdate[]);

    const { data: segments } = await supabase
      .from('call_transcript_segments')
      .select('*')
      .eq('call_mission_id', missionId)
      .order('sequence_number');

    if (segments) {
      setTranscript(
        segments.map((s) => ({
          id: s.id,
          callMissionId: s.call_mission_id,
          callSessionId: s.call_session_id,
          sourceEventId: s.source_event_id,
          speaker: s.speaker,
          text: s.text,
          startTimeMs: s.start_time_ms,
          endTimeMs: s.end_time_ms,
          sequenceNumber: s.sequence_number,
          isFinal: s.is_final,
          createdAt: s.created_at,
        })),
      );
    }

    setLoading(false);
  }, [missionId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAcceptField = async (fieldId: string) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await fetch(`/api/calls/${missionId}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fieldId, reviewStatus: 'accepted', reviewedBy: user.id }),
    });

    setResultFields((prev) =>
      prev.map((f) => (f.id === fieldId ? { ...f, review_status: 'accepted' } : f)),
    );
  };

  const handleEditField = async (fieldId: string, newValue: string) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await fetch(`/api/calls/${missionId}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fieldId,
        reviewStatus: 'edited',
        reviewedValue: newValue,
        reviewedBy: user.id,
      }),
    });

    setResultFields((prev) =>
      prev.map((f) =>
        f.id === fieldId ? { ...f, review_status: 'edited', reviewed_value: newValue } : f,
      ),
    );
  };

  const handleRejectField = async (fieldId: string) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await fetch(`/api/calls/${missionId}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fieldId, reviewStatus: 'rejected', reviewedBy: user.id }),
    });

    setResultFields((prev) =>
      prev.map((f) => (f.id === fieldId ? { ...f, review_status: 'rejected' } : f)),
    );
  };

  const handleViewEvidence = (fieldId: string) => {
    const field = resultFields.find((f) => f.id === fieldId);
    if (field) {
      setHighlightedSegments(field.evidence_segment_ids);
      setActiveTab('transcript');
    }
  };

  const handleAcceptUpdate = async (updateId: string) => {
    await fetch(`/api/calls/${missionId}/updates/${updateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewStatus: 'accepted' }),
    });
    setProposedUpdates((prev) =>
      prev.map((u) => (u.id === updateId ? { ...u, review_status: 'accepted' } : u)),
    );
  };

  const handleEditUpdate = async (updateId: string, newValue: string) => {
    await fetch(`/api/calls/${missionId}/updates/${updateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewStatus: 'edited', reviewedValue: newValue }),
    });
    setProposedUpdates((prev) =>
      prev.map((u) =>
        u.id === updateId
          ? { ...u, review_status: 'edited', reviewed_value: newValue }
          : u,
      ),
    );
  };

  const handleRejectUpdate = async (updateId: string) => {
    await fetch(`/api/calls/${missionId}/updates/${updateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewStatus: 'rejected' }),
    });
    setProposedUpdates((prev) =>
      prev.map((u) => (u.id === updateId ? { ...u, review_status: 'rejected' } : u)),
    );
  };

  const handleApplyAllAccepted = async () => {
    const accepted = proposedUpdates.filter(
      (u) => u.review_status === 'accepted' || u.review_status === 'edited',
    );
    for (const update of accepted) {
      await fetch(`/api/calls/${missionId}/updates/${update.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply' }),
      });
    }
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-navy-200 border-t-navy-700 rounded-full" />
      </div>
    );
  }

  if (!mission) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Mission not found.</p>
        <Link href={`/cases/${caseId}/calls`}>
          <Button variant="outline" className="mt-4">Back to Calls</Button>
        </Link>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'summary', label: 'Summary', count: resultFields.length },
    {
      id: 'updates',
      label: 'Proposed Updates',
      count: proposedUpdates.filter((u) => u.review_status === 'pending').length,
    },
    { id: 'transcript', label: 'Transcript' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/cases/${caseId}/calls`}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{mission.title}</h1>
            <CallStatusBadge status={mission.status} />
            <OutcomeBadge outcome={mission.outcome} />
          </div>
          <p className="text-sm text-slate-500">
            {mission.organization_name} &middot;{' '}
            {formatPhoneNumber(mission.destination_phone)}
          </p>
        </div>
      </div>

      <div className="border-b border-slate-200">
        <nav className="flex gap-1 -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-navy-700 text-navy-800'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-navy-100 text-navy-700 text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Mission Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Type</dt>
                  <dd className="font-medium">{mission.mission_type.replace(/_/g, ' ')}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Goal</dt>
                  <dd className="font-medium text-right max-w-[60%]">{mission.goal}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Status</dt>
                  <dd><CallStatusBadge status={mission.status} /></dd>
                </div>
                {mission.outcome && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Outcome</dt>
                    <dd><OutcomeBadge outcome={mission.outcome} /></dd>
                  </div>
                )}
                {mission.failure_reason && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Failure Reason</dt>
                    <dd className="text-red-600">{mission.failure_reason}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Call Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-slate-400" />
                  <dt className="text-slate-500">Organization</dt>
                  <dd className="ml-auto font-medium">{mission.organization_name}</dd>
                </div>
                {mission.department && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Department</dt>
                    <dd>{mission.department}</dd>
                  </div>
                )}
                {mission.contact_name && (
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-slate-400" />
                    <dt className="text-slate-500">Contact</dt>
                    <dd className="ml-auto">{mission.contact_name}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-slate-500">Phone</dt>
                  <dd className="font-mono">
                    {formatPhoneNumber(mission.destination_phone)}
                    {mission.extension && ` ext. ${mission.extension}`}
                  </dd>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-slate-400" />
                  <dt className="text-slate-500">Duration</dt>
                  <dd className="ml-auto tabular-nums">
                    {formatDuration(mission.duration_seconds)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Created</dt>
                  <dd>{format(new Date(mission.created_at), 'MMM d, yyyy h:mm a')}</dd>
                </div>
                {mission.authorized_at && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Authorized</dt>
                    <dd>{format(new Date(mission.authorized_at), 'MMM d, yyyy h:mm a')}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'summary' && (
        <div className="space-y-6">
          {summary && (
            <Card>
              <CardHeader>
                <CardTitle>Post-Call Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {summary}
                </p>
              </CardContent>
            </Card>
          )}

          {resultFields.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-4">
                Extracted Fields
              </h3>
              <div className="space-y-3">
                {resultFields.map((field) => (
                  <ResultFieldReview
                    key={field.id}
                    fieldId={field.id}
                    fieldKey={field.field_key}
                    fieldLabel={field.field_label}
                    extractedValue={field.extracted_value}
                    confidence={field.confidence}
                    reviewStatus={field.review_status}
                    reviewedValue={field.reviewed_value}
                    onAccept={handleAcceptField}
                    onEdit={handleEditField}
                    onReject={handleRejectField}
                    onViewEvidence={handleViewEvidence}
                  />
                ))}
              </div>
            </div>
          )}

          {!summary && resultFields.length === 0 && (
            <div className="text-center py-12">
              <p className="text-slate-500">
                No results available yet. Results will appear after the call completes.
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'updates' && (
        <div className="space-y-6">
          {proposedUpdates.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">
                  Proposed Case Updates
                </h3>
                {proposedUpdates.some(
                  (u) => u.review_status === 'accepted' || u.review_status === 'edited',
                ) && (
                  <Button onClick={handleApplyAllAccepted}>
                    Apply All Accepted
                  </Button>
                )}
              </div>
              <div className="space-y-3">
                {proposedUpdates.map((update) => (
                  <ProposedUpdateCard
                    key={update.id}
                    updateId={update.id}
                    targetField={update.target_field}
                    currentValue={update.current_value}
                    proposedValue={update.proposed_value}
                    reason={update.reason}
                    reviewStatus={update.review_status}
                    reviewedValue={update.reviewed_value}
                    onAccept={handleAcceptUpdate}
                    onEdit={handleEditUpdate}
                    onReject={handleRejectUpdate}
                  />
                ))}
              </div>
            </>
          )}

          {proposedUpdates.length === 0 && (
            <div className="text-center py-12">
              <p className="text-slate-500">
                No proposed updates. Updates will appear after call results are processed.
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'transcript' && (
        <div>
          {transcript.length > 0 ? (
            <TranscriptViewer
              segments={transcript}
              highlightedSegmentIds={highlightedSegments}
            />
          ) : (
            <div className="text-center py-12">
              <p className="text-slate-500">
                No transcript available. The transcript will appear during or after the call.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
