'use client';

import { Save } from 'lucide-react';
import { QUALIFICATION_RESULT_LABELS, type QualificationResultValue } from '@outbound-call/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { InboundPageHeader, LoadingSpinner, SaveMessage, WarningBox, selectClass } from '@/components/inbound/page-header';
import { useInboundSettings } from '@/components/inbound/use-inbound-settings';

const ELIGIBLE: QualificationResultValue[] = ['high_priority', 'qualified'];

export default function ContractsPage() {
  const { config, setConfig, loading, loadError, saving, message, save } = useInboundSettings();
  if (loading) return <LoadingSpinner />;

  const c = config.contracts;
  const set = (patch: Partial<typeof c>) => setConfig((cfg) => ({ ...cfg, contracts: { ...cfg.contracts, ...patch } }));

  return (
    <div className="space-y-6 max-w-3xl">
      <InboundPageHeader title="Contracts" description="Whether and how the AI may text an engagement agreement during the call." />
      {loadError && <WarningBox>{loadError}</WarningBox>}

      <Card className={config.flags.contracts_enabled ? 'border-amber-300' : ''}>
        <CardContent className="pt-5 space-y-3">
          <Toggle
            checked={config.flags.contracts_enabled}
            onChange={(v) => void save('flags', { ...config.flags, contracts_enabled: v })}
            disabled={saving === 'flags'}
            label="Engagement agreements enabled"
            description="Off by default. When off, the AI never mentions or sends an agreement."
          />
          {config.flags.contracts_enabled && !config.flags.sms_enabled && c.provider !== 'webhook' && (
            <WarningBox>SMS is turned off in Settings, so agreements cannot be texted.</WarningBox>
          )}
          <WarningBox>
            Even when enabled, an agreement is only offered when the qualification rules allow it, all intake questions are answered,
            and the caller clearly agrees. The AI never tells the caller they are a client.
          </WarningBox>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provider</CardTitle>
          <CardDescription>How the agreement link is produced.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <select className={`${selectClass} w-80`} value={c.provider} onChange={(e) => set({ provider: e.target.value as typeof c.provider })}>
            <option value="none">None</option>
            <option value="sms_link">Text a link to our e-sign form</option>
            <option value="webhook">E-sign integration (webhook)</option>
          </select>

          {c.provider === 'sms_link' && (
            <Input
              id="sms-link"
              label="E-sign link"
              value={c.sms_link_url}
              onChange={(e) => set({ sms_link_url: e.target.value })}
              hint="{{intake_id}} is replaced with the intake ID so the signed form can be matched."
            />
          )}
          {c.provider === 'webhook' && (
            <div className="space-y-2">
              <Input
                id="webhook-url"
                label="Integration URL"
                value={c.webhook_url}
                onChange={(e) => set({ webhook_url: e.target.value })}
                hint="We POST the intake (intake_id, caller_name, phone, email, language, case_type, incident_date) and expect { external_id, signing_url }."
              />
            </div>
          )}
          {c.provider !== 'none' && (
            <Textarea
              id="sms-template"
              label="Text message"
              rows={3}
              className="min-h-0"
              value={c.sms_message_template}
              onChange={(e) => set({ sms_message_template: e.target.value })}
            />
          )}
          <p className="text-xs text-slate-500">
            Signature status: your e-sign tool can POST <code>{'{ "intake_id" or "external_id", "status": "signed" }'}</code> to{' '}
            <code>/webhooks/inbound/contracts/&lt;provider&gt;</code> on the voice worker with header <code>X-Inbound-Contract-Secret</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eligibility</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Qualification results that may receive an agreement</p>
            {ELIGIBLE.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={c.allowed_results.includes(r)}
                  onChange={(e) =>
                    set({ allowed_results: e.target.checked ? [...c.allowed_results, r] : c.allowed_results.filter((x) => x !== r) })
                  }
                />
                {QUALIFICATION_RESULT_LABELS[r]}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-6">
            <Toggle checked={c.business_hours_allowed} onChange={(v) => set({ business_hours_allowed: v })} label="During business hours" />
            <Toggle checked={c.after_hours_allowed} onChange={(v) => set({ after_hours_allowed: v })} label="After hours" />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => save('contracts', c)} disabled={saving === 'contracts'}>
          <Save className="h-4 w-4 mr-1.5" /> {saving === 'contracts' ? 'Saving...' : 'Save contract settings'}
        </Button>
        <SaveMessage message={message} />
      </div>
    </div>
  );
}
