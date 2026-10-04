'use client';

import { useState } from 'react';
import { Download, Save } from 'lucide-react';
import {
  CONTRACT_DELIVERY_METHODS,
  QUALIFICATION_RESULT_LABELS,
  type ContractDeliveryMethod,
  type QualificationResultValue,
} from '@outbound-call/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { InboundPageHeader, LoadingSpinner, SaveMessage, WarningBox, selectClass } from '@/components/inbound/page-header';
import { useInboundSettings } from '@/components/inbound/use-inbound-settings';

const ELIGIBLE: QualificationResultValue[] = ['high_priority', 'qualified'];
const DELIVERY_LABELS: Record<ContractDeliveryMethod, string> = { sms: 'Text message', email: 'Email' };

type Lang = 'en' | 'es';

export default function ContractsPage() {
  const { config, setConfig, loading, loadError, saving, message, save } = useInboundSettings();
  const [importing, setImporting] = useState<Lang | null>(null);
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  if (loading) return <LoadingSpinner />;

  const c = config.contracts;
  const set = (patch: Partial<typeof c>) => setConfig((cfg) => ({ ...cfg, contracts: { ...cfg.contracts, ...patch } }));
  const templateId = (lang: Lang) => (lang === 'es' ? c.signflow_template_id_es : c.signflow_template_id_en);
  const parseId = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);

  async function importText(lang: Lang) {
    const id = templateId(lang) ?? (lang === 'es' ? c.signflow_template_id_en : null);
    if (!id) {
      setImportMsg({ kind: 'error', text: 'Enter the template ID first.' });
      return;
    }
    setImporting(lang);
    setImportMsg(null);
    try {
      const res = await fetch(`/api/inbound/contracts/template-text?templateId=${id}`);
      const body = (await res.json()) as { error?: string; name?: string; text?: string; truncated?: boolean };
      if (!res.ok || !body.text) throw new Error(body.error ?? 'Import failed');
      set(lang === 'es' ? { knowledge_es: body.text } : { knowledge_en: body.text });
      setImportMsg({
        kind: 'ok',
        text: `Loaded "${body.name || `template ${id}`}"${body.truncated ? ' (truncated)' : ''}. Review it, then save.`,
      });
    } catch (e) {
      setImportMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Import failed' });
    } finally {
      setImporting(null);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <InboundPageHeader
        title="Contracts"
        description="Whether the AI may send an engagement agreement during the call, how it is delivered, and what the AI knows about it."
      />
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
          {config.flags.contracts_enabled && !config.flags.sms_enabled && c.provider === 'sms_link' && (
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
          <CardDescription>How the agreement is produced and delivered.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <select className={`${selectClass} w-80`} value={c.provider} onChange={(e) => set({ provider: e.target.value as typeof c.provider })}>
            <option value="none">None</option>
            <option value="signflow">Sign Flow (DocuSeal)</option>
            <option value="sms_link">Text a link to our e-sign form</option>
            <option value="webhook">E-sign integration (webhook)</option>
          </select>

          {c.provider === 'signflow' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  id="tpl-en"
                  label="DocuSeal template ID (English)"
                  inputMode="numeric"
                  value={c.signflow_template_id_en ?? ''}
                  onChange={(e) => set({ signflow_template_id_en: parseId(e.target.value) })}
                />
                <Input
                  id="tpl-es"
                  label="DocuSeal template ID (Spanish)"
                  inputMode="numeric"
                  value={c.signflow_template_id_es ?? ''}
                  onChange={(e) => set({ signflow_template_id_es: parseId(e.target.value) })}
                  hint="Optional. Spanish callers get the English template when blank."
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">The caller may choose</p>
                <div className="flex gap-6">
                  {CONTRACT_DELIVERY_METHODS.map((m) => (
                    <label key={m} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={c.delivery_methods.includes(m)}
                        onChange={(e) =>
                          set({ delivery_methods: e.target.checked ? [...c.delivery_methods, m] : c.delivery_methods.filter((x) => x !== m) })
                        }
                      />
                      {DELIVERY_LABELS[m]}
                    </label>
                  ))}
                </div>
                {c.delivery_methods.length === 0 && <WarningBox>Pick at least one delivery method.</WarningBox>}
              </div>
              <Toggle
                checked={c.stay_on_line_to_sign}
                onChange={(v) => set({ stay_on_line_to_sign: v })}
                label="Stay on the line until it is signed"
                description="After sending, the AI helps the caller open, review, and sign, and confirms the signature with Sign Flow before saying it went through."
              />
              <p className="text-xs text-slate-500">
                Sign Flow sends the text (from its Quo contract number) or email, runs its normal reminders if they don&apos;t finish, and
                tells the voice worker when the agreement is opened or signed. The incident date is filled in as the date of loss.
              </p>
            </div>
          )}

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
            <Input
              id="webhook-url"
              label="Integration URL"
              value={c.webhook_url}
              onChange={(e) => set({ webhook_url: e.target.value })}
              hint="We POST the intake (intake_id, caller_name, phone, email, language, case_type, incident_date) and expect { external_id, signing_url }."
            />
          )}
          {(c.provider === 'sms_link' || c.provider === 'webhook') && (
            <>
              <Textarea
                id="sms-template"
                label="Text message"
                rows={3}
                className="min-h-0"
                value={c.sms_message_template}
                onChange={(e) => set({ sms_message_template: e.target.value })}
              />
              <p className="text-xs text-slate-500">
                Signature status: your e-sign tool can POST <code>{'{ "intake_id" or "external_id", "status": "signed" }'}</code> to{' '}
                <code>/webhooks/inbound/contracts/&lt;provider&gt;</code> on the voice worker with header <code>X-Inbound-Contract-Secret</code>.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {c.provider !== 'none' && (
        <Card>
          <CardHeader>
            <CardTitle>What the AI knows about the agreement</CardTitle>
            <CardDescription>
              The AI answers questions only from this text, in plain words, and never advises whether to sign. Anything not covered is noted
              for the team.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              id="approved-answers"
              label="Firm-approved answers (take priority)"
              rows={5}
              placeholder={'Q: What is your fee?\nA: ...\nQ: What if we do not win?\nA: ...'}
              value={c.approved_answers}
              onChange={(e) => set({ approved_answers: e.target.value })}
            />
            {(['en', 'es'] as const).map((lang) => (
              <div key={lang} className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">
                    Agreement text ({lang === 'en' ? 'English' : 'Spanish, optional'})
                  </p>
                  {c.provider === 'signflow' && (
                    <Button variant="outline" size="sm" onClick={() => void importText(lang)} disabled={importing !== null}>
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      {importing === lang ? 'Loading...' : 'Load from Sign Flow template'}
                    </Button>
                  )}
                </div>
                <Textarea
                  id={`knowledge-${lang}`}
                  rows={8}
                  value={lang === 'en' ? c.knowledge_en : c.knowledge_es}
                  onChange={(e) => set(lang === 'en' ? { knowledge_en: e.target.value } : { knowledge_es: e.target.value })}
                  placeholder={lang === 'en' ? 'Paste the agreement text, or load it from the template.' : 'Blank = the AI uses the English text.'}
                />
              </div>
            ))}
            <SaveMessage message={importMsg} />
          </CardContent>
        </Card>
      )}

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
