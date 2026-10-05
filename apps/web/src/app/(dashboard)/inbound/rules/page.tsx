'use client';

import { useState } from 'react';
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  DEFAULT_QUALIFICATION_RULES,
  INBOUND_CASE_TYPES,
  INJURY_SEVERITIES,
  QUALIFICATION_RESULT_LABELS,
  QUALIFICATION_RESULTS,
  RULE_FIELDS,
  RULE_OPERATORS,
  type QualificationRule,
  type RuleCondition,
  type RuleField,
  type RuleOperator,
} from '@outbound-call/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { InboundPageHeader, LoadingSpinner, SaveMessage, WarningBox, selectClass } from '@/components/inbound/page-header';
import { useInboundSettings } from '@/components/inbound/use-inbound-settings';
import { LinePicker } from '@/components/inbound/line-context';
import { QualificationBadge } from '@/components/inbound/badges';

const OP_LABELS: Record<RuleOperator, string> = {
  eq: 'equals',
  neq: 'does not equal',
  in: 'is one of',
  not_in: 'is not one of',
  is_true: 'is yes',
  is_false: 'is no',
  is_set: 'is known',
  is_not_set: 'is unknown',
  gte: '≥',
  lte: '≤',
};

const FIELD_LABELS: Partial<Record<RuleField, string>> = {
  incident_age_days: 'Days since incident',
  injury_severity_rank: 'Injury severity rank (0 none – 4 catastrophic)',
  injury_reported: 'Injury reported',
  any_urgent_indicator: 'Any urgent indicator',
};

const NUMERIC_FIELDS: RuleField[] = ['incident_age_days', 'injury_severity_rank'];
const NO_VALUE_OPS: RuleOperator[] = ['is_true', 'is_false', 'is_set', 'is_not_set'];
const LIST_OPS: RuleOperator[] = ['in', 'not_in'];

function valueHint(field: RuleField): string {
  if (field === 'case_type') return INBOUND_CASE_TYPES.join(', ');
  if (field === 'injury_severity') return INJURY_SEVERITIES.join(', ');
  if (field === 'caller_at_fault') return 'no, yes, partial, unknown';
  if (field === 'incident_state') return 'Two-letter state codes, e.g. TX';
  return '';
}

function ConditionEditor({ cond, onChange, onRemove }: { cond: RuleCondition; onChange: (c: RuleCondition) => void; onRemove: () => void }) {
  const needsValue = !NO_VALUE_OPS.includes(cond.op);
  const isList = LIST_OPS.includes(cond.op);
  const isNumber = NUMERIC_FIELDS.includes(cond.field);
  const display = Array.isArray(cond.value) ? cond.value.join(', ') : cond.value === undefined ? '' : String(cond.value);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={`${selectClass} w-60`} value={cond.field} onChange={(e) => onChange({ ...cond, field: e.target.value as RuleField })}>
        {RULE_FIELDS.map((f) => (
          <option key={f} value={f}>{FIELD_LABELS[f] ?? f.replace(/_/g, ' ')}</option>
        ))}
      </select>
      <select
        className={`${selectClass} w-40`}
        value={cond.op}
        onChange={(e) => {
          const op = e.target.value as RuleOperator;
          onChange({ ...cond, op, value: NO_VALUE_OPS.includes(op) ? undefined : LIST_OPS.includes(op) ? [] : cond.value });
        }}
      >
        {RULE_OPERATORS.map((o) => (
          <option key={o} value={o}>{OP_LABELS[o]}</option>
        ))}
      </select>
      {needsValue && (
        <input
          className={`${selectClass} w-64`}
          value={display}
          placeholder={isList ? 'comma, separated, values' : valueHint(cond.field)}
          title={valueHint(cond.field)}
          onChange={(e) => {
            const raw = e.target.value;
            const value = isList
              ? raw.split(',').map((s) => s.trim()).filter(Boolean)
              : isNumber
                ? Number(raw)
                : raw;
            onChange({ ...cond, value });
          }}
        />
      )}
      <button type="button" onClick={onRemove} className="p-1.5 text-slate-400 hover:text-red-600" title="Remove condition">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function QualificationRulesPage() {
  const { config, setConfig, loading, loadError, saving, message, save } = useInboundSettings();
  const [dirty, setDirty] = useState(false);
  const q = config.qualification;

  const update = (rules: QualificationRule[], default_result = q.default_result) => {
    setConfig((c) => ({ ...c, qualification: { rules, default_result } }));
    setDirty(true);
  };
  const updateRule = (idx: number, patch: Partial<QualificationRule>) => update(q.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6 max-w-5xl">
      <InboundPageHeader
        title="Qualification Rules"
        description="The AI only collects facts. These rules decide the result. Reasons are stored for staff and never read to the caller."
      />
      <LinePicker />
      {loadError && <WarningBox>{loadError}</WarningBox>}

      <Card>
        <CardContent className="pt-4 text-sm text-slate-700 space-y-1">
          <p><strong>How results combine:</strong> any matching <em>Not currently qualified</em> rule wins. Otherwise <em>High priority</em> beats <em>Needs review</em>, which beats <em>Qualified</em>. If nothing matches, the default result applies.</p>
          <p><strong>Engagement agreement:</strong> only offered if a matching Qualified/High-priority rule allows it and no matching rule blocks it (and contracts are enabled).</p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-72">
          <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="default-result">Default result (no rule matched)</label>
          <select id="default-result" className={selectClass} value={q.default_result} onChange={(e) => update(q.rules, e.target.value as typeof q.default_result)}>
            {QUALIFICATION_RESULTS.map((r) => <option key={r} value={r}>{QUALIFICATION_RESULT_LABELS[r]}</option>)}
          </select>
        </div>
      </div>

      {q.rules.map((rule, idx) => (
        <Card key={rule.id} className={rule.enabled ? '' : 'opacity-60'}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Toggle checked={rule.enabled} onChange={(v) => updateRule(idx, { enabled: v })} />
              <input
                className="text-base font-semibold text-slate-900 bg-transparent border-b border-transparent focus:border-slate-300 focus:outline-none w-80"
                value={rule.name}
                onChange={(e) => updateRule(idx, { name: e.target.value })}
              />
              <QualificationBadge result={rule.result} />
            </div>
            <button
              type="button"
              className="p-1.5 text-slate-400 hover:text-red-600"
              title="Delete rule"
              onClick={() => update(q.rules.filter((_, i) => i !== idx))}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">When all of these are true</p>
            {rule.conditions.map((cond, ci) => (
              <ConditionEditor
                key={ci}
                cond={cond}
                onChange={(c) => updateRule(idx, { conditions: rule.conditions.map((x, j) => (j === ci ? c : x)) })}
                onRemove={() => updateRule(idx, { conditions: rule.conditions.filter((_, j) => j !== ci) })}
              />
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => updateRule(idx, { conditions: [...rule.conditions, { field: 'case_type', op: 'eq', value: 'motor_vehicle' }] })}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add condition
            </Button>
            <div className="grid gap-3 sm:grid-cols-3 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Result</label>
                <select className={selectClass} value={rule.result} onChange={(e) => updateRule(idx, { result: e.target.value as QualificationRule['result'] })}>
                  {QUALIFICATION_RESULTS.map((r) => <option key={r} value={r}>{QUALIFICATION_RESULT_LABELS[r]}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Input label="Internal reason (staff only)" value={rule.reason} onChange={(e) => updateRule(idx, { reason: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <Toggle checked={rule.can_send_contract} onChange={(v) => updateRule(idx, { can_send_contract: v })} label="Allows engagement agreement" />
              <Toggle checked={rule.blocks_contract} onChange={(v) => updateRule(idx, { blocks_contract: v })} label="Blocks engagement agreement" />
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-3 sticky bottom-0 bg-slate-50/90 backdrop-blur py-3">
        <Button
          variant="outline"
          onClick={() =>
            update([
              ...q.rules,
              {
                id: `rule_${Date.now()}`,
                name: 'New rule',
                enabled: true,
                conditions: [{ field: 'case_type', op: 'eq', value: 'motor_vehicle' }],
                result: 'needs_review',
                reason: 'Describe why this rule applies',
                can_send_contract: false,
                blocks_contract: false,
              },
            ])
          }
        >
          <Plus className="h-4 w-4 mr-1.5" /> Add rule
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            if (confirm('Replace all rules with the built-in defaults?')) update(DEFAULT_QUALIFICATION_RULES, 'needs_review');
          }}
        >
          <RotateCcw className="h-4 w-4 mr-1.5" /> Reset to defaults
        </Button>
        <Button
          onClick={async () => {
            if (await save('qualification', config.qualification)) setDirty(false);
          }}
          disabled={saving === 'qualification'}
        >
          <Save className="h-4 w-4 mr-1.5" /> {saving === 'qualification' ? 'Saving...' : 'Save rules'}
        </Button>
        {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
        <SaveMessage message={message} />
      </div>
    </div>
  );
}
