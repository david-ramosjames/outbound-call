'use client';

import { Input } from '@/components/ui/input';
import type { Destination } from '@outbound-call/shared';

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
  errors: Record<string, string>;
  onChange: (field: keyof Destination, value: string) => void;
}

export function DestinationStep({ data, errors, onChange }: DestinationStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Destination</h2>
        <p className="text-sm text-slate-500 mt-1">
          Who will the AI agent call? Provide the organization and phone number.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="organizationName"
          label="Organization Name *"
          placeholder="e.g. State Farm Insurance"
          value={data.organizationName ?? ''}
          onChange={(e) => onChange('organizationName', e.target.value)}
          error={errors.organizationName}
        />
        <Input
          id="department"
          label="Department"
          placeholder="e.g. Claims Department"
          value={data.department ?? ''}
          onChange={(e) => onChange('department', e.target.value)}
        />
      </div>

      <Input
        id="contactName"
        label="Contact Name"
        placeholder="e.g. John Smith (if known)"
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
            hint="US phone number in any format"
          />
        </div>
        <Input
          id="extension"
          label="Extension"
          placeholder="ext. 1234"
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
