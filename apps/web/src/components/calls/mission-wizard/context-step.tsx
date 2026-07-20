'use client';

import { AlertTriangle, Shield } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import {
  RESTRICTED_FIELDS,
  CONTEXT_FIELD_GROUPS,
  CONTEXT_FIELD_PLACEHOLDERS,
} from '@outbound-call/shared';
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
  const indexByField = new Map(
    contextFields.map((field, index) => [field.field, index] as const),
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Approved Context</h2>
        <p className="text-sm text-slate-500 mt-1">
          Enter everything the bot is allowed to use on this call. Toggle a field
          on to authorize disclosure. Empty fields stay off unless you type a value.
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
              The following are <strong>never</strong> disclosed:{' '}
              {RESTRICTED_FIELDS.map((f) => f.replace(/_/g, ' ')).join(', ')}.
              If an IVR asks for SSN, the bot should say it does not have it and
              continue with DOB, phone, ZIP, policy, or claim number instead.
            </p>
          </div>
        </div>
      </div>

      {CONTEXT_FIELD_GROUPS.map((group) => (
        <section key={group.id} className="space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                {group.title}
              </h3>
              {group.primary && (
                <span className="rounded-full bg-navy-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy-700">
                  Primary
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{group.description}</p>
          </div>

          <div className="space-y-2">
            {group.fields.map((fieldKey) => {
              const index = indexByField.get(fieldKey);
              if (index == null) return null;
              const field = contextFields[index]!;
              const displayValue = field.missionSpecificValue ?? field.value;
              const placeholder =
                CONTEXT_FIELD_PLACEHOLDERS[field.field] ??
                'Enter value for this call';

              return (
                <div
                  key={field.field}
                  className={cn(
                    'rounded-lg border p-3 transition-colors',
                    field.included
                      ? 'border-navy-200 bg-navy-50/40'
                      : 'border-slate-200 bg-white',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Toggle
                      checked={field.included}
                      onChange={() => onToggleField(index)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <label
                          htmlFor={`ctx-${field.field}`}
                          className="text-sm font-medium text-slate-900"
                        >
                          {field.label}
                        </label>
                        {field.included && (
                          <Shield className="h-3.5 w-3.5 text-navy-600" />
                        )}
                      </div>
                      {field.value &&
                        field.missionSpecificValue !== undefined &&
                        field.missionSpecificValue !== field.value && (
                          <p className="text-[11px] text-slate-500">
                            Case value: {field.value}
                          </p>
                        )}
                      <input
                        id={`ctx-${field.field}`}
                        type="text"
                        value={displayValue}
                        placeholder={placeholder}
                        onChange={(e) => {
                          const next = e.target.value;
                          onUpdateValue(index, next);
                        }}
                        className="w-full h-9 px-2.5 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-firm-accent"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
