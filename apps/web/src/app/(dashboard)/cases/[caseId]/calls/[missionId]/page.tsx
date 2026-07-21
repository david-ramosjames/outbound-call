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
  const [xaiStatus, setXaiStatus] = useState<string | null>(null);
  const [xaiCallId, setXaiCallId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [completingReview, setCompletingReview] = useState(false);
  const [highlightedSegments, setHighlightedSegments] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    const supabase = createClient();

    const { data: missionData } = await supabase
      .from('call_missions')
      .select('*')
      .eq('id', missionId)
      .single();

    if (missionData) {
      setMission(missionData as CallMission);
    }

    const { data: sessionData } = await supabase
      .from('call_sessions')
      .select('xai_connection_status, xai_call_id')
      .eq('call_mission_id', missionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionData) {
      setXaiStatus(sessionData.xai_connection_status ?? null);
      setXaiCallId(sessionData.xai_call_id ?? null);
    }

    const { data: resultData } = await supabase
      .from('call_results')
      .select('*')
      .eq('call_mission_id', missionId)
      .maybeSingle();

    if (resultData) {
      setSummary(resultData.summary ?? '');

      const { data: fields } = await supabase
        .from('call_result_fields')
        .select('*')
        .eq('call_result_id', resultData.id)
        .order('created_at');

      if (fields && fields.length > 0) {
        setResultFields(fields as CallResultField[]);
      } else {
        // Backfill display from structured_results when field rows were never written
        const structured = (resultData.structured_results ?? {}) as Record<
          string,
          unknown
        >;
        const fallbackKeys: Array<{ key: string; label: string; valueKey: string }> = [
          { key: 'claim_number', label: 'Claim Number', valueKey: 'claimNumber' },
          { key: 'adjuster_name', label: 'Adjuster Name', valueKey: 'adjusterName' },
          { key: 'adjuster_phone', label: 'Adjuster Phone', valueKey: 'adjusterPhone' },
          { key: 'adjuster_email', label: 'Adjuster Email', valueKey: 'adjusterEmail' },
          {
            key: 'representative_name',
            label: 'Representative Name',
            valueKey: 'representativeName',
          },
        ];
        setResultFields(
          fallbackKeys
            .filter((f) => structured[f.valueKey] != null && structured[f.valueKey] !== '')
            .map((f) => ({
              id: `structured-${f.key}`,
              field_key: f.key,
              field_label: f.label,
              extracted_value: structured[f.valueKey],
              confidence: 1,
              evidence_segment_ids: [],
              review_status: 'pending' as ReviewStatus,
              reviewed_value: null,
            })),
        );
      }
    } else {
      setSummary('');
      setResultFields([]);
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

  useEffect(() => {
    if (mission?.status === 'awaiting_review') {
      setActiveTab((prev) => (prev === 'overview' ? 'summary' : prev));
    }
  }, [mission?.status]);

  const handleAcceptField = async (fieldId: string) => {
    if (fieldId.startsWith('structured-')) return;
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
    if (fieldId.startsWith('structured-')) return;
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
    if (fieldId.startsWith('structured-')) return;
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

  const handleCompleteReview = async () => {
    setCompletingReview(true);
    try {
      const response = await fetch(`/api/calls/${missionId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete_review' }),
      });
      if (!response.ok) {
        const data = await response.json();
        alert(data.error ?? 'Failed to complete review');
        return;
      }
      setMission((prev) => (prev ? { ...prev, status: 'reviewed' } : prev));
    } finally {
      setCompletingReview(false);
    }
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
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">{mission.title}</h1>
            <CallStatusBadge status={mission.status} />
            <OutcomeBadge outcome={mission.outcome} />
          </div>
          <p className="text-sm text-slate-500">
            {mission.organization_name} &middot;{' '}
            {formatPhoneNumber(mission.destination_phone)}
          </p>
        </div>
        {mission.status === 'awaiting_review' && (
          <Button onClick={handleCompleteReview} disabled={completingReview}>
            {completingReview ? 'Saving…' : 'Mark Review Complete'}
          </Button>
        )}
      </div>

      {mission.status === 'awaiting_review' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Review required</p>
          <p className="text-sm text-amber-800 mt-1">
            Open the Summary, Proposed Updates, and Transcript tabs. Accept or reject
            extracted fields and case updates, then click <strong>Mark Review Complete</strong>.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button size="sm" variant="outline" onClick={() => setActiveTab('summary')}>
              Summary ({resultFields.length})
            </Button>
            <Button size="sm" variant="outline" onClick={() => setActiveTab('updates')}>
              Updates ({proposedUpdates.length})
            </Button>
            <Button size="sm" variant="outline" onClick={() => setActiveTab('transcript')}>
              Transcript ({transcript.length})
            </Button>
          </div>
        </div>
      )}

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
            <div className="text-center py-12 space-y-2">
              <p className="text-slate-500">
                No summary or extracted fields yet.
              </p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                These appear after the voice session finishes and post-call processing
                runs. If the call never joined xAI (no transcript), results will stay empty.
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
            <div className="text-center py-12 space-y-2">
              <p className="text-slate-500">
                No proposed case updates for this call.
              </p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Updates are created when the bot records claim number, adjuster name,
                phone, or email during the live session. Check the Summary tab for any
                extracted values that were saved without a proposed update row.
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
            <div className="text-center py-12 space-y-2">
              <p className="text-slate-500">No transcript available for this call.</p>
              <p className="text-xs text-slate-400 max-w-lg mx-auto">
                {!xaiCallId
                  ? 'The xAI SIP session never joined (no call_id). Twilio connected, but the voice agent WebSocket did not start — so nothing was transcribed. Confirm the xAI Direct SIP webhook points to your voice worker /webhooks/xai/sip.'
                  : `xAI status: ${xaiStatus ?? 'unknown'}. Transcripts are saved live from the xAI WebSocket; if the socket dropped before speech events, segments will be empty.`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
