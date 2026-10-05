'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, Copy, RefreshCw, Save, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InboundPageHeader, LoadingSpinner, SaveMessage, WarningBox } from '@/components/inbound/page-header';
import { cn } from '@/lib/utils';

type Need = 'required' | 'inbound' | 'contracts' | 'optional';

interface EnvVar {
  key: string;
  need: Need;
  purpose: string;
}

const WORKER_VARS: EnvVar[] = [
  { key: 'SUPABASE_URL', need: 'required', purpose: 'Database the worker reads settings from and writes calls to.' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', need: 'required', purpose: 'Server database key (secret).' },
  { key: 'VOICE_WORKER_INTERNAL_SECRET', need: 'required', purpose: 'Shared secret so only this web app can call the worker. Must match the web app.' },
  { key: 'VOICE_WORKER_BASE_URL', need: 'required', purpose: "The worker's own public https URL. Used for Twilio callbacks and the Sign Flow status callback." },
  { key: 'APP_BASE_URL', need: 'required', purpose: 'Public URL of this web app.' },
  { key: 'TWILIO_ACCOUNT_SID', need: 'required', purpose: 'Twilio account (all intake numbers live here).' },
  { key: 'TWILIO_AUTH_TOKEN', need: 'required', purpose: 'Twilio secret. Also verifies that webhooks really come from Twilio.' },
  { key: 'TWILIO_PHONE_NUMBER', need: 'required', purpose: 'Caller ID for outbound calls. Intake numbers are set per line, not here.' },
  { key: 'XAI_API_KEY', need: 'required', purpose: 'xAI voice agent (secret).' },
  { key: 'XAI_AGENT_ID', need: 'required', purpose: 'xAI voice agent id.' },
  { key: 'XAI_SIP_URI', need: 'inbound', purpose: 'Where Twilio bridges the call audio to xAI.' },
  { key: 'XAI_SIP_WEBHOOK_SECRET', need: 'inbound', purpose: 'Verifies xAI call webhooks (secret).' },
  { key: 'SIGNFLOW_INTAKE_TOKEN', need: 'contracts', purpose: 'Bearer token for Sign Flow, both directions. Must equal SIGNFLOW_INTAKE_TOKEN on Sign Flow.' },
  { key: 'INBOUND_CONTRACT_WEBHOOK_SECRET', need: 'optional', purpose: 'Only for non-Sign Flow e-sign tools posting signature status. Not needed with Sign Flow.' },
];

const WEB_VARS: EnvVar[] = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL', need: 'required', purpose: 'Database URL for the browser.' },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', need: 'required', purpose: 'Public database key (access is limited by row-level security).' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', need: 'required', purpose: 'Server database key (secret).' },
  { key: 'NEXT_PUBLIC_APP_URL', need: 'required', purpose: 'Public URL of this web app (Google sign-in redirects).' },
  { key: 'VOICE_WORKER_BASE_URL', need: 'required', purpose: 'Where the web app reaches the voice worker.' },
  { key: 'VOICE_WORKER_INTERNAL_SECRET', need: 'required', purpose: 'Must match the worker. The web app needs no Sign Flow or xAI keys.' },
];

const SIGNFLOW_VARS: EnvVar[] = [
  { key: 'SIGNFLOW_INTAKE_TOKEN', need: 'contracts', purpose: 'Same token as the worker. Authenticates the worker and signs status callbacks.' },
  { key: 'DOCUSEAL_API_URL', need: 'optional', purpose: 'Fallback DocuSeal connection. Usually set per account in Sign Flow → Admin → Firms.' },
  { key: 'DOCUSEAL_API_KEY', need: 'optional', purpose: 'Fallback DocuSeal key (secret). Usually set per account.' },
  { key: 'DOCUSEAL_WEBHOOK_SECRET', need: 'optional', purpose: 'Lets DocuSeal tell Sign Flow the moment a document is signed.' },
  { key: 'QUO_API_KEY', need: 'optional', purpose: 'Fallback Quo key for texting the signing link. Usually set per account.' },
  { key: 'GMAIL_SERVICE_ACCOUNT_EMAIL', need: 'optional', purpose: 'Sends the signing link by email (or use SendGrid).' },
  { key: 'SENDGRID_API_KEY', need: 'optional', purpose: 'Alternative email sender.' },
  { key: 'SIGNFLOW_EMAIL_PUBLIC_ORIGIN', need: 'optional', purpose: 'Public URL used in emailed links.' },
  { key: 'CRON_SECRET', need: 'optional', purpose: 'Runs the reminder job for unsigned agreements.' },
];

const NEED_LABEL: Record<Need, string> = {
  required: 'Required',
  inbound: 'Needed for AI answering',
  contracts: 'Needed for agreements',
  optional: 'Optional',
};

interface SetupData {
  web: Record<string, boolean>;
  worker: {
    error?: string;
    mode?: string;
    env?: Record<string, boolean>;
    urls?: { voice: string; status: string; signflowCallback: string };
    lines?: Array<{ id: string; name: string; phone_numbers: string[]; is_default: boolean }>;
  };
  signflow: {
    error?: string;
    firms?: Array<{ id: string; name: string; docusealConfigured?: boolean; quoConfigured?: boolean; quoFromNumber?: string | null }>;
    env?: Record<string, boolean>;
  };
  integrations: { signflow_base_url?: string };
  integrationsAvailable: boolean;
}

function Status({ value, need }: { value: boolean | undefined; need: Need }) {
  if (value === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
        <CircleDashed className="h-3.5 w-3.5" /> Unknown
      </span>
    );
  }
  if (value) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> Loaded
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', need === 'optional' ? 'text-slate-500' : 'text-amber-700')}>
      {need === 'optional' ? <CircleDashed className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />} TBD
    </span>
  );
}

function EnvTable({ title, where, vars, values, error }: { title: string; where: string; vars: EnvVar[]; values?: Record<string, boolean>; error?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{where}</CardDescription>
      </CardHeader>
      {error && (
        <div className="px-6 pb-3">
          <WarningBox>Could not check: {error}</WarningBox>
        </div>
      )}
      <div className="divide-y divide-slate-100">
        {vars.map((v) => (
          <div key={v.key} className="px-6 py-2.5 grid grid-cols-[16rem_7rem_1fr] gap-4 items-start text-sm">
            <div>
              <code className="text-xs font-semibold text-slate-800">{v.key}</code>
              <p className="text-[11px] text-slate-500">{NEED_LABEL[v.need]}</p>
            </div>
            <Status value={values?.[v.key]} need={v.need} />
            <p className="text-xs text-slate-600">{v.purpose}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 text-slate-600">{label}</span>
      <code className="flex-1 truncate rounded bg-slate-100 px-2 py-1 text-xs">{value}</code>
      <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(value)}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Why are some things settings and others environment variables?',
    a: 'Environment variables hold only secrets (API keys, tokens) and the addresses services use to find each other. Everything else (phone numbers, firm names, hours, routing, rules, instructions, which Sign Flow account and template to use, and the Sign Flow URL) is a setting you can change here without a redeploy.',
  },
  {
    q: 'How do I add a new firm or brand?',
    a: 'Buy a Twilio number, set its Voice URL and status callback to the URLs below, then on Intake Lines add a line with that number and its Sign Flow account. Configure the line on each settings page, then turn on "AI answers calls" in Settings.',
  },
  {
    q: 'Where are the phone numbers configured?',
    a: 'Per line on Intake Lines. Transfer, backup and SMS numbers are per line on Routing & Hours. The only number in the environment is TWILIO_PHONE_NUMBER, which outbound calling uses.',
  },
  {
    q: 'How does the worker know an agreement was signed?',
    a: "Sign Flow posts to the worker's Sign Flow callback URL (sent with each request, authenticated with SIGNFLOW_INTAKE_TOKEN). While the caller is on the phone the AI also checks the status directly before confirming.",
  },
  {
    q: 'Something shows TBD. What do I do?',
    a: 'Add the variable in that service’s hosting dashboard (Railway for the voice worker, Vercel for the web app and Sign Flow) and redeploy that service. Optional items can stay TBD.',
  },
];

export default function SetupPage() {
  const [data, setData] = useState<SetupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [signflowUrl, setSignflowUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/inbound/setup');
    const body = (await res.json().catch(() => null)) as SetupData | null;
    setData(body);
    setSignflowUrl(body?.integrations?.signflow_base_url ?? '');
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveIntegrations = async () => {
    setSaving(true);
    setMsg(null);
    const res = await fetch('/api/inbound/setup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ integrations: { signflow_base_url: signflowUrl } }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setMsg({ kind: 'error', text: body.error ?? 'Save failed' });
      return;
    }
    setMsg({ kind: 'ok', text: 'Saved. Checking the connection...' });
    await load();
  };

  if (loading && !data) return <LoadingSpinner />;
  const worker = data?.worker ?? {};
  const signflow = data?.signflow ?? {};

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <InboundPageHeader
          title="Setup & Environment"
          description="Connections between services, which environment variables are loaded, and what still needs setting up. Values are never shown."
        />
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} /> Recheck
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>Non-secret connection settings. Changes apply within a few seconds, no redeploy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data?.integrationsAvailable && <WarningBox>Run migration 20240101000010_inbound_lines.sql to enable integration settings.</WarningBox>}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Input
                id="signflow-url"
                label="Sign Flow URL"
                value={signflowUrl}
                onChange={(e) => setSignflowUrl(e.target.value)}
                placeholder="https://sign-flow.vercel.app"
                hint="The Sign Flow deployment that sends agreements. Its token (SIGNFLOW_INTAKE_TOKEN) stays in the environment."
              />
            </div>
            <Button onClick={saveIntegrations} disabled={saving} className="mb-5">
              <Save className="h-4 w-4 mr-1.5" /> {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
          <SaveMessage message={msg} />
          <div className="rounded-lg border border-slate-200 p-3 text-sm">
            <p className="font-medium text-slate-800 mb-2">Sign Flow connection</p>
            {signflow.error ? (
              <p className="text-amber-700 text-xs">{signflow.error}</p>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-emerald-700 font-medium">Connected. Accounts:</p>
                {(signflow.firms ?? []).map((f) => (
                  <p key={f.id} className="text-xs text-slate-600">
                    <span className="font-medium text-slate-800">{f.name}</span> <code>{f.id}</code> · DocuSeal{' '}
                    {f.docusealConfigured ? 'connected' : 'not set up'} · Quo {f.quoConfigured ? `connected${f.quoFromNumber ? ` (${f.quoFromNumber})` : ''}` : 'not set up'}
                  </p>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {worker.urls && (
        <Card>
          <CardHeader>
            <CardTitle>Twilio numbers</CardTitle>
            <CardDescription>
              Every intake number uses the same URLs (Twilio → Phone Numbers → the number → Voice Configuration). The worker picks the line from
              the number dialed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <CopyRow label="A call comes in (POST)" value={worker.urls.voice} />
            <CopyRow label="Call status changes" value={worker.urls.status} />
            <CopyRow label="Sign Flow callback" value={worker.urls.signflowCallback} />
            {!worker.urls.voice.startsWith('https://') && (
              <WarningBox>VOICE_WORKER_BASE_URL on the worker is not an https URL, so Twilio and Sign Flow cannot reach it.</WarningBox>
            )}
            <div className="pt-3">
              <p className="text-sm font-medium text-slate-700 mb-1">Numbers and lines</p>
              {(worker.lines ?? []).length === 0 && <p className="text-xs text-slate-500">No active lines (or migration not run).</p>}
              {(worker.lines ?? []).map((l) => (
                <p key={l.id} className="text-xs text-slate-600">
                  <span className="font-medium text-slate-800">{l.name}</span>
                  {l.is_default ? ' (default)' : ''}: {l.phone_numbers.length ? l.phone_numbers.join(', ') : 'no numbers'}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <EnvTable
        title="Voice worker"
        where={`Railway → voice worker → Variables${worker.mode ? ` · running in ${worker.mode} mode` : ''}`}
        vars={WORKER_VARS}
        values={worker.env}
        error={worker.error}
      />
      <EnvTable title="Web app" where="Vercel (or wherever this dashboard is hosted) → Environment Variables" vars={WEB_VARS} values={data?.web} />
      <EnvTable title="Sign Flow" where="Sign Flow's Vercel project → Environment Variables" vars={SIGNFLOW_VARS} values={signflow.env} error={signflow.error} />

      <Card>
        <CardHeader>
          <CardTitle>FAQ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {FAQ.map((f) => (
            <div key={f.q}>
              <p className="text-sm font-medium text-slate-800">{f.q}</p>
              <p className="text-sm text-slate-600 mt-0.5">{f.a}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
