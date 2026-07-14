'use client';

import { AlertTriangle, Shield } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { RESTRICTED_FIELDS } from '@outbound-call/shared';
import type { ApprovedContextEntry } from '@outbound-call/shared';

interface ContextStepProps {
  contextFields: ApprovedContextEntry[];
  onToggleField: (index: number) => void;
  onUpdateValue: (index: number, value: string) => void;
}

export function ContextStep({
  contextFields,
  onToggleField,
  onUpdateValue,
}: ContextStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Approved Context</h2>
        <p className="text-sm text-slate-500 mt-1">
          Select which case fields the AI agent is authorized to disclose during the call.
          Only toggled-on fields will be available to the agent.
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              Restricted Information Warning
            </p>
            <p className="text-xs text-amber-700 mt-1">
              The following fields are <strong>never</strong> disclosed:{' '}
              {RESTRICTED_FIELDS.map((f) => f.replace(/_/g, ' ')).join(', ')}.
              These are enforced at the system level and cannot be overridden.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {contextFields.map((field, index) => (
          <div
            key={field.field}
            className={cn(
              'rounded-lg border p-4 transition-colors',
              field.included
                ? 'border-navy-200 bg-navy-50/50'
                : 'border-slate-200 bg-white',
            )}
          >
            <div className="flex items-start gap-4">
              <Toggle
                checked={field.included}
                onChange={() => onToggleField(index)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-slate-900">
                    {field.label}
                  </span>
                  {field.included && (
                    <Shield className="h-3.5 w-3.5 text-navy-600" />
                  )}
                </div>
                <p className="text-xs text-slate-500 mb-2">
                  Current value from case
                </p>
                <div className="text-sm font-mono text-slate-700 bg-white border border-slate-200 rounded px-2 py-1">
                  {field.value || <span className="text-slate-400 italic">Not set</span>}
                </div>
                {field.included && (
                  <div className="mt-2">
                    <label className="text-xs text-slate-500 block mb-1">
                      Mission-specific value (optional override)
                    </label>
                    <input
                      type="text"
                      placeholder="Leave blank to use case value"
                      value={field.missionSpecificValue ?? ''}
                      onChange={(e) => onUpdateValue(index, e.target.value)}
                      className="w-full h-8 px-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-firm-accent"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
