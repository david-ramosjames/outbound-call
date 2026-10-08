'use client';

import { AlertTriangle, Shield } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import {
  RESTRICTED_FIELDS,
  CONTEXT_FIELD_GROUPS,
  CONTEXT_FIELD_PLACEHOLDERS,
  NOT_AVAILABLE_RESPONSE,
  WITHHELD_BY_DEFAULT_FIELDS,
} from '@outbound-call/shared';
import type { ApprovedContextEntry } from '@outbound-call/shared';

const withheld = new Set<string>(WITHHELD_BY_DEFAULT_FIELDS);

interface ContextStepProps {
  contextFields: ApprovedContextEntry[];
  onToggleField: (index: number) => void;
  onUpdateValue: (index: number, value: string) => void;
  /** field → where its pre-filled value came from (e.g. "previous call to GEICO on 10/6/2026"). */
  suggestions?: Record<string, string>;
}

export function ContextStep({
  contextFields,
  onToggleField,
  onUpdateValue,
  suggestions = {},
}: ContextStepProps) {
  const indexByField = new Map(
    contextFields.map((field, index) => [field.field, index] as const),
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Approved Context</h2>
        <p className="text-sm text-slate-500 mt-1">
          Turn on only the minimum the carrier needs to open or locate the claim.
          Toggle a field on to authorize disclosure. Anything left off gets the
          answer &ldquo;{NOT_AVAILABLE_RESPONSE}&rdquo;
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
              If asked for SSN or a driver&apos;s license number, the bot says
              &ldquo;{NOT_AVAILABLE_RESPONSE}&rdquo; Date of birth, client phone, and
              client address are off by default even when the case has them. The
              bot will never discuss the client&apos;s injuries, medical status, fault,
              or liability, so don&apos;t enter them in any field.
            </p>
          </div>
        </div>
      </div>

      {Object.keys(suggestions).length > 0 && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800">
          Some fields are pre-filled from earlier calls on this case (marked below). Check they&apos;re still
          right for this carrier before sharing them.
        </div>
      )}

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
                      {withheld.has(field.field) && (
                        <p className="text-[11px] text-amber-700">
                          Off by default. Turn on only if the carrier can&apos;t open the
                          claim without it.
                        </p>
                      )}
                      {suggestions[field.field] && displayValue && (
                        <p className="text-[11px] text-sky-700">
                          From {suggestions[field.field]}
                        </p>
                      )}
                      {field.value &&
                        !suggestions[field.field] &&
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
