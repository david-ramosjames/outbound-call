'use client';

import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import type { InboundLineMeta, InboundLineRow } from '@outbound-call/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { InboundPageHeader, LoadingSpinner, SaveMessage, WarningBox, selectClass } from '@/components/inbound/page-header';
import { useInboundLine } from '@/components/inbound/line-context';

interface FirmOption {
  id: string;
  name: string;
  docusealConfigured?: boolean;
  quoConfigured?: boolean;
}

type Msg = { kind: 'ok' | 'error'; text: string } | null;

const EMPTY: InboundLineMeta = { name: '', slug: '', phone_numbers: [], signflow_firm_id: '', is_default: false, active: true };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function errorText(body: { error?: string; details?: Array<{ path: string[]; message: string }> }): string {
  const detail = body.details?.length ? `: ${body.details.map((d) => `${d.path.join('.')} ${d.message}`).join('; ')}` : '';
  return `${body.error ?? 'Save failed'}${detail}`;
}

function useFirms() {
  const [firms, setFirms] = useState<FirmOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/inbound/signflow/firms')
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { error?: string; firms?: FirmOption[] };
        if (!res.ok || !body.firms) setError(body.error ?? `HTTP ${res.status}`);
        else setFirms(body.firms);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'request failed'));
  }, []);
  return { firms, error };
}

function LineForm({
  initial,
  firms,
  submitLabel,
  onSubmit,
  extra,
}: {
  initial: InboundLineMeta;
  firms: FirmOption[] | null;
  submitLabel: string;
  onSubmit: (meta: InboundLineMeta) => Promise<Msg>;
  extra?: React.ReactNode;
}) {
  const [meta, setMeta] = useState<InboundLineMeta>(initial);
  const [phones, setPhones] = useState(initial.phone_numbers.join('\n'));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [slugTouched, setSlugTouched] = useState(Boolean(initial.slug));
  const set = (patch: Partial<InboundLineMeta>) => setMeta((m) => ({ ...m, ...patch }));
  const firmKnown = !firms || meta.signflow_firm_id === '' || firms.some((f) => f.id === meta.signflow_firm_id);

  const submit = async () => {
    setSaving(true);
    setMsg(null);
    const result = await onSubmit({ ...meta, phone_numbers: phones.split(/[\n,]+/).map((p) => p.trim()).filter(Boolean) });
    setSaving(false);
    setMsg(result);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input
          id={`name-${initial.slug || 'new'}`}
          label="Name (what the AI calls the firm)"
          value={meta.name}
          onChange={(e) => set({ name: e.target.value, ...(slugTouched ? {} : { slug: slugify(e.target.value) }) })}
          placeholder="Trucking Chicas"
        />
        <Input
          id={`slug-${initial.slug || 'new'}`}
          label="Short name"
          value={meta.slug}
          onChange={(e) => {
            setSlugTouched(true);
            set({ slug: e.target.value });
          }}
          hint="Lowercase letters, numbers and dashes."
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Phone numbers this line answers</label>
          <textarea
            className="flex w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-accent"
            rows={3}
            value={phones}
            onChange={(e) => setPhones(e.target.value)}
            placeholder={'+17372323927'}
          />
          <p className="text-xs text-slate-500">One per line. These are the Twilio numbers Quo forwards to (the number the caller is connected to).</p>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Sign Flow account (for agreements)</label>
          {firms && firmKnown ? (
            <select className={selectClass} value={meta.signflow_firm_id} onChange={(e) => set({ signflow_firm_id: e.target.value })}>
              <option value="">Sign Flow default account</option>
              {firms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.id}){f.docusealConfigured === false ? ' — DocuSeal not set up' : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={selectClass}
              value={meta.signflow_firm_id}
              onChange={(e) => set({ signflow_firm_id: e.target.value })}
              placeholder="ramos-james"
            />
          )}
          <p className="text-xs text-slate-500">Agreements, templates, and the contract text message come from this Sign Flow account.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-8">
        <Toggle checked={meta.active} onChange={(v) => set({ active: v })} label="Active" description="Inactive lines don't answer calls." />
        <Toggle
          checked={meta.is_default}
          onChange={(v) => set({ is_default: v })}
          label="Default line"
          description="Answers calls to numbers no other line lists."
          disabled={initial.is_default}
        />
      </div>
      {extra}
      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={saving}>
          <Save className="h-4 w-4 mr-1.5" /> {saving ? 'Saving...' : submitLabel}
        </Button>
        <SaveMessage message={msg} />
      </div>
    </div>
  );
}

export default function IntakeLinesPage() {
  const { lines, linesAvailable, loading, reload, setLineId } = useInboundLine();
  const { firms, error: firmsError } = useFirms();
  const [adding, setAdding] = useState(false);
  const [copyFromId, setCopyFromId] = useState('');

  if (loading) return <LoadingSpinner />;

  const update = async (line: InboundLineRow, meta: InboundLineMeta): Promise<Msg> => {
    const res = await fetch(`/api/inbound/lines/${line.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line: meta }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { kind: 'error', text: errorText(body) };
    await reload();
    return { kind: 'ok', text: 'Saved.' };
  };

  const create = async (meta: InboundLineMeta): Promise<Msg> => {
    const res = await fetch('/api/inbound/lines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line: meta, copyFromId: copyFromId || null }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { kind: 'error', text: errorText(body) };
    await reload();
    if (body.id) setLineId(body.id);
    setAdding(false);
    return { kind: 'ok', text: 'Line created.' };
  };

  const remove = async (line: InboundLineRow) => {
    if (!confirm(`Delete "${line.name}"? Its settings and instructions are removed. Past calls and intakes are kept.`)) return;
    const res = await fetch(`/api/inbound/lines/${line.id}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) alert(body.error ?? 'Delete failed');
    await reload();
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <InboundPageHeader
        title="Intake Lines"
        description="One line per firm or brand. Each has its own phone numbers, greeting and instructions, hours and routing, qualification rules, and agreement."
      />
      {!linesAvailable && (
        <WarningBox>
          Run migration <code>20240101000010_inbound_lines.sql</code> in the Supabase SQL editor to enable multiple lines.
        </WarningBox>
      )}
      {firmsError && <WarningBox>Could not load Sign Flow accounts ({firmsError}). You can type the account id instead.</WarningBox>}

      <Card>
        <CardContent className="pt-5 text-sm text-slate-600 space-y-2">
          <p>
            <span className="font-medium text-slate-800">How calls are routed:</span> every Twilio number points to the same voice worker URL
            (see Setup &amp; Environment). The worker matches the number that was dialed to a line below; numbers no line lists go to the
            default line.
          </p>
          <p>
            After adding a line, pick it in the line selector on Settings, Routing &amp; Hours, Qualification Rules, Agent Instructions,
            and Contracts to configure it. New lines start with the AI turned off.
          </p>
        </CardContent>
      </Card>

      {lines.map((line) => (
        <Card key={line.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {line.name}
              {line.is_default && <span className="text-xs font-semibold text-navy-700 bg-navy-50 rounded px-2 py-0.5">Default</span>}
              {!line.active && <span className="text-xs font-semibold text-slate-600 bg-slate-100 rounded px-2 py-0.5">Inactive</span>}
            </CardTitle>
            <CardDescription>{line.phone_numbers.length ? line.phone_numbers.join(', ') : 'No phone numbers yet'}</CardDescription>
          </CardHeader>
          <CardContent>
            <LineForm
              key={`${line.id}-${firms ? 'f' : 'n'}`}
              initial={line}
              firms={firms}
              submitLabel="Save line"
              onSubmit={(meta) => update(line, meta)}
              extra={
                !line.is_default && (
                  <Button variant="outline" size="sm" onClick={() => void remove(line)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete line
                  </Button>
                )
              }
            />
          </CardContent>
        </Card>
      ))}

      {linesAvailable &&
        (adding ? (
          <Card className="border-navy-200">
            <CardHeader>
              <CardTitle>New intake line</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="w-80 space-y-1.5">
                <label className="block text-sm font-medium text-slate-700">Start from</label>
                <select className={selectClass} value={copyFromId} onChange={(e) => setCopyFromId(e.target.value)}>
                  <option value="">Built-in defaults</option>
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      Copy of {l.name} (rules, hours, routing, agreement, instructions)
                    </option>
                  ))}
                </select>
              </div>
              <LineForm key={`new-${firms ? 'f' : 'n'}`} initial={EMPTY} firms={firms} submitLabel="Create line" onSubmit={create} />
              <Button variant="outline" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add intake line
          </Button>
        ))}
    </div>
  );
}
