'use client';

import { Save } from 'lucide-react';
import type { InboundFlags } from '@outbound-call/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Toggle } from '@/components/ui/toggle';
import { InboundPageHeader, LoadingSpinner, SaveMessage, WarningBox } from '@/components/inbound/page-header';
import { useInboundSettings } from '@/components/inbound/use-inbound-settings';

const FLAGS: Array<{ key: keyof InboundFlags; label: string; description: string; risky?: boolean }> = [
  { key: 'inbound_enabled', label: 'Inbound intake enabled', description: 'Master switch. When off, calls to the intake number use fallback routing.', risky: true },
  { key: 'inbound_voice_enabled', label: 'AI answers calls', description: 'Bridge calls to the Grok Voice agent. Both this and the master switch must be on.', risky: true },
  { key: 'after_hours_ai_enabled', label: 'AI answers after hours', description: 'When off, after-hours calls use fallback routing.' },
  { key: 'qualification_enabled', label: 'Qualification engine', description: 'Apply qualification rules during the call.' },
  { key: 'human_transfer_enabled', label: 'Human transfer', description: 'Allow live transfers to the numbers in Routing & Hours.', risky: true },
  { key: 'sms_enabled', label: 'SMS', description: 'Allow approved text messages (and agreement links) to the caller.', risky: true },
  { key: 'contracts_enabled', label: 'Engagement agreements', description: 'Allow the AI to text an engagement agreement when rules permit.', risky: true },
  { key: 'spanish_enabled', label: 'Spanish', description: 'Allow the AI to switch to Spanish automatically.' },
  { key: 'live_dashboard_enabled', label: 'Live call view', description: 'Show live transcripts on the call page.' },
];

export default function InboundSettingsPage() {
  const { config, setConfig, loading, loadError, saving, message, save } = useInboundSettings();
  if (loading) return <LoadingSpinner />;
  const flags = config.flags;

  return (
    <div className="space-y-6 max-w-3xl">
      <InboundPageHeader title="Settings" description="Feature flags for the inbound intake agent. Risky capabilities are off by default." />
      {loadError && <WarningBox>{loadError}</WarningBox>}

      <Card>
        <CardHeader>
          <CardTitle>Feature Flags</CardTitle>
          <CardDescription>Changes apply to the next call. Every change is recorded in the audit log.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {FLAGS.map((f) => (
            <div key={f.key} className="flex items-start justify-between gap-4">
              <Toggle
                checked={flags[f.key]}
                onChange={(v) => setConfig((c) => ({ ...c, flags: { ...c.flags, [f.key]: v } }))}
                label={f.label}
                description={f.description}
              />
              {f.risky && <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 shrink-0">Review before enabling</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => save('flags', flags)} disabled={saving === 'flags'}>
          <Save className="h-4 w-4 mr-1.5" /> {saving === 'flags' ? 'Saving...' : 'Save flags'}
        </Button>
        <SaveMessage message={message} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Phone Setup</CardTitle>
          <CardDescription>Quo stays as-is. It forwards to a dedicated AI intake number, which points at the voice worker.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-700 space-y-2">
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>Buy or choose a Twilio number to be the AI intake number.</li>
            <li>
              In Twilio, set its <strong>Voice webhook</strong> (HTTP POST) to <code>{'<voice worker URL>'}/webhooks/inbound/twilio/voice</code> and
              its <strong>Status callback</strong> to <code>{'<voice worker URL>'}/webhooks/inbound/twilio/status</code>.
            </li>
            <li>Test with the Test Agent, then call the AI intake number directly.</li>
            <li>When ready, set Quo to forward (or overflow) calls to the AI intake number.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
