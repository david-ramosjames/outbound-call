'use client';

import { Input } from '@/components/ui/input';
import {
  MISSION_TYPES,
  MISSION_TYPE_LABELS,
  MISSION_TEMPLATES_BY_TYPE,
} from '@outbound-call/shared';
import type { Destination, MissionType } from '@outbound-call/shared';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

interface DestinationStepProps {
  data: Partial<Destination>;
  missionType: MissionType;
  errors: Record<string, string>;
  onChange: (field: keyof Destination, value: string) => void;
  onMissionTypeChange: (missionType: MissionType) => void;
}

export function DestinationStep({
  data,
  missionType,
  errors,
  onChange,
  onMissionTypeChange,
}: DestinationStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Destination</h2>
        <p className="text-sm text-slate-500 mt-1">
          Choose the call purpose, then who to dial. Purpose controls which facts
          are pre-selected and the default script goals.
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">
          Call purpose *
        </label>
        <div className="grid gap-2">
          {MISSION_TYPES.map((type) => {
            const template = MISSION_TEMPLATES_BY_TYPE[type];
            const selected = missionType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => onMissionTypeChange(type)}
                className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
                  selected
                    ? 'border-navy-300 bg-navy-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="text-sm font-medium text-slate-900">
                  {MISSION_TYPE_LABELS[type]}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {template.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="organizationName"
          label="Organization Name *"
          placeholder="e.g. GEICO, State Farm, USAA"
          value={data.organizationName ?? ''}
          onChange={(e) => onChange('organizationName', e.target.value)}
          error={errors.organizationName}
        />
        <Input
          id="department"
          label="Department"
          placeholder="e.g. Claims / Total Loss / PIP"
          value={data.department ?? ''}
          onChange={(e) => onChange('department', e.target.value)}
        />
      </div>

      <Input
        id="contactName"
        label="Contact Name"
        placeholder="e.g. Will Holman (if known)"
        value={data.contactName ?? ''}
        onChange={(e) => onChange('contactName', e.target.value)}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Input
            id="phoneNumber"
            label="Phone Number *"
            placeholder="(555) 123-4567"
            value={data.phoneNumber ?? ''}
            onChange={(e) => onChange('phoneNumber', e.target.value)}
            error={errors.phoneNumber}
            hint="Main claims line or direct adjuster number"
          />
        </div>
        <Input
          id="extension"
          label="Extension"
          placeholder="e.g. 79848"
          value={data.extension ?? ''}
          onChange={(e) => onChange('extension', e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="destinationTimezone"
          className="block text-sm font-medium text-slate-700"
        >
          Destination Time Zone
        </label>
        <select
          id="destinationTimezone"
          value={data.destinationTimezone ?? 'America/Chicago'}
          onChange={(e) => onChange('destinationTimezone', e.target.value)}
          className="flex h-10 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-accent"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace('_', ' ').replace('America/', '').replace('Pacific/', '')} ({tz})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
