'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { History, Save } from 'lucide-react';
import {
  INBOUND_CASE_TYPE_LABELS,
  INBOUND_CASE_TYPES,
  resolveAgentInstructions,
  type AgentInstructions,
} from '@outbound-call/shared';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { InboundPageHeader, LoadingSpinner, SaveMessage } from '@/components/inbound/page-header';
import { LinePicker, useInboundLine } from '@/components/inbound/line-context';

interface VersionRow {
  version: number;
  is_active: boolean;
  note: string | null;
  created_by_email: string | null;
  created_at: string;
  content: unknown;
}

type TextKey = Exclude<keyof AgentInstructions, 'case_type_instructions'>;

const SECTIONS: Array<{ title: string; description: string; fields: Array<{ key: TextKey; label: string; rows?: number }> }> = [
  {
    title: 'Identity & Greeting',
    description: 'Who the agent is and how it answers the phone.',
    fields: [
      { key: 'agent_identity', label: 'Agent identity', rows: 3 },
      { key: 'greeting_en', label: 'Greeting (English)', rows: 2 },
      { key: 'greeting_es', label: 'Greeting (Spanish)', rows: 2 },
      { key: 'required_disclosures', label: 'Required disclosures', rows: 3 },
    ],
  },
  {
    title: 'Tone & Language',
    description: 'How the agent sounds in each language.',
    fields: [
      { key: 'tone', label: 'Tone', rows: 3 },
      { key: 'english_instructions', label: 'English instructions', rows: 2 },
      { key: 'spanish_instructions', label: 'Spanish instructions', rows: 2 },
    ],
  },
  {
    title: 'Guardrails & Escalation',
    description: 'One item per line. These are added on top of the built-in guardrails, which cannot be removed.',
    fields: [
      { key: 'never_say', label: 'Never say', rows: 7 },
      { key: 'escalation_instructions', label: 'Escalation instructions', rows: 3 },
    ],
  },
  {
    title: 'Scripted Language',
    description: 'Exact phrasing for key moments. {{next_open}} is replaced with when the office opens next.',
    fields: [
      { key: 'transfer_language', label: 'Before a transfer', rows: 2 },
      { key: 'transfer_failed_language', label: 'Transfer failed', rows: 3 },
      { key: 'contract_language', label: 'Offering the engagement agreement', rows: 2 },
      { key: 'hesitation_language', label: 'When the caller hesitates to sign', rows: 2 },
      { key: 'decline_language', label: 'Declining politely', rows: 3 },
      { key: 'after_hours_language', label: 'After hours', rows: 2 },
      { key: 'existing_client_language', label: 'Existing clients', rows: 2 },
    ],
  },
];

export default function AgentInstructionsPage() {
  const { lineId: selectedLineId, linesAvailable, loading: linesLoading } = useInboundLine();
  const lineId = linesAvailable ? selectedLineId : null;
  const [content, setContent] = useState<AgentInstructions>(() => resolveAgentInstructions({}));
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (linesLoading) return;
    const supabase = createClient();
    let query = supabase
      .from('inbound_agent_instructions')
      .select('version, is_active, note, created_by_email, created_at, content')
      .order('version', { ascending: false })
      .limit(50);
    if (lineId) query = query.eq('line_id', lineId);
    const { data } = await query;
    const rows = (data ?? []) as VersionRow[];
    setVersions(rows);
    setContent(resolveAgentInstructions(rows.find((r) => r.is_active)?.content));
    setLoading(false);
  }, [lineId, linesLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveVersion = async () => {
    setSaving(true);
    setMessage(null);
    const res = await fetch('/api/inbound/instructions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, note, lineId }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setMessage({ kind: 'error', text: body.error ?? 'Save failed' });
      return;
    }
    setNote('');
    setMessage({ kind: 'ok', text: `Saved as version ${body.version}. New calls use it immediately.` });
    await load();
  };

  const activate = async (version: number) => {
    if (!confirm(`Make version ${version} the active instructions?`)) return;
    await fetch('/api/inbound/instructions/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, lineId }),
    });
    await load();
  };

  if (loading || linesLoading) return <LoadingSpinner />;
  const set = (key: TextKey, value: string) => setContent((c) => ({ ...c, [key]: value }));

  return (
    <div className="space-y-6 max-w-4xl">
      <InboundPageHeader
        title="Agent Instructions"
        description="Edit what the intake agent says on this line. Every save creates a new version; you can roll back at any time. {{firm_name}} is replaced with the line's name."
      />
      <LinePicker hint="Each line has its own instructions and version history." />

      {SECTIONS.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            <CardDescription>{section.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {section.fields.map((f) => (
              <Textarea
                key={f.key}
                id={f.key}
                label={f.label}
                rows={f.rows}
                className="min-h-0"
                value={content[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
              />
            ))}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Case-Type Instructions</CardTitle>
          <CardDescription>Optional extra guidance for specific case types (added to the built-in question topics).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {INBOUND_CASE_TYPES.filter((t) => t !== 'unknown').map((t) => (
            <Textarea
              key={t}
              id={`ct-${t}`}
              label={INBOUND_CASE_TYPE_LABELS[t]}
              rows={2}
              className="min-h-0"
              value={content.case_type_instructions[t] ?? ''}
              onChange={(e) =>
                setContent((c) => {
                  const next = { ...c.case_type_instructions };
                  if (e.target.value.trim()) next[t] = e.target.value;
                  else delete next[t];
                  return { ...c, case_type_instructions: next };
                })
              }
            />
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end gap-3 sticky bottom-0 bg-slate-50/90 backdrop-blur py-3">
        <div className="w-96">
          <Input id="version-note" label="Change note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed and why" />
        </div>
        <Button onClick={saveVersion} disabled={saving}>
          <Save className="h-4 w-4 mr-1.5" /> {saving ? 'Saving...' : 'Save new version'}
        </Button>
        <SaveMessage message={message} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Version History
          </CardTitle>
        </CardHeader>
        <div className="divide-y divide-slate-100">
          {versions.length === 0 && <p className="px-6 py-4 text-sm text-slate-500">No saved versions yet. The built-in defaults are in use.</p>}
          {versions.map((v) => (
            <div key={v.version} className="px-6 py-3 flex items-center gap-4 text-sm">
              <span className="font-semibold w-12">v{v.version}</span>
              <span className="text-slate-500 w-40">{format(new Date(v.created_at), 'MMM d, yyyy h:mm a')}</span>
              <span className="text-slate-600 w-48 truncate">{v.created_by_email ?? '—'}</span>
              <span className="text-slate-700 flex-1 truncate">{v.note ?? ''}</span>
              {v.is_active ? (
                <span className="text-xs font-semibold text-emerald-700">Active</span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => activate(v.version)}>
                  Activate
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
