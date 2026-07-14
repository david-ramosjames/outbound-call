'use client';

import { useState } from 'react';
import {
  Phone,
  Shield,
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  Target,
  Ban,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MockModeBanner } from '@/components/calls/mock-mode-banner';
import { cn } from '@/lib/utils';
import { formatPhoneNumber } from '@/lib/utils';
import type { Destination, MissionInstructions, ApprovedContextEntry } from '@outbound-call/shared';

interface ReviewStepProps {
  destination: Partial<Destination>;
  contextFields: ApprovedContextEntry[];
  instructions: MissionInstructions;
  aiDisclosureText: string;
  onSaveDraft: () => void;
  onLaunch: () => void;
  onCancel: () => void;
  isLaunching: boolean;
}

export function ReviewStep({
  destination,
  contextFields,
  instructions,
  aiDisclosureText,
  onSaveDraft,
  onLaunch,
  onCancel,
  isLaunching,
}: ReviewStepProps) {
  const [authorized, setAuthorized] = useState(false);
  const includedFields = contextFields.filter((f) => f.included);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Pre-Call Review</h2>
        <p className="text-sm text-slate-500 mt-1">
          Review all details before launching this AI-assisted call.
        </p>
      </div>

      <MockModeBanner />

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Phone className="h-4 w-4 text-navy-700" />
            <h3 className="font-semibold text-slate-900">Call Destination</h3>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Organization</dt>
            <dd className="font-medium">{destination.organizationName}</dd>
            {destination.department && (
              <>
                <dt className="text-slate-500">Department</dt>
                <dd>{destination.department}</dd>
              </>
            )}
            {destination.contactName && (
              <>
                <dt className="text-slate-500">Contact</dt>
                <dd>{destination.contactName}</dd>
              </>
            )}
            <dt className="text-slate-500">Phone Number</dt>
            <dd className="font-mono font-medium">
              {formatPhoneNumber(destination.phoneNumber ?? '')}
              {destination.extension && ` ext. ${destination.extension}`}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4 text-navy-700" />
            <h3 className="font-semibold text-slate-900">AI Disclosure</h3>
          </div>
          <p className="text-sm text-slate-700 italic bg-slate-50 rounded-lg p-3 border">
            &ldquo;{aiDisclosureText}&rdquo;
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-4 w-4 text-navy-700" />
            <h3 className="font-semibold text-slate-900">Mission Goal</h3>
          </div>
          <p className="text-sm text-slate-700">{instructions.goal}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-4 w-4 text-navy-700" />
            <h3 className="font-semibold text-slate-900">
              Approved Facts ({includedFields.length})
            </h3>
          </div>
          {includedFields.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No fields selected.</p>
          ) : (
            <div className="space-y-1">
              {includedFields.map((f) => (
                <div
                  key={f.field}
                  className="flex items-center justify-between text-sm py-1 border-b border-slate-100 last:border-0"
                >
                  <span className="text-slate-600">{f.label}</span>
                  <span className="font-mono text-slate-900">
                    {f.missionSpecificValue || f.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-3">
            <FileWarning className="h-4 w-4 text-navy-700" />
            <h3 className="font-semibold text-slate-900">Information to Collect</h3>
          </div>
          <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
            {instructions.requiredInformation.filter(Boolean).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-red-200">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Ban className="h-4 w-4 text-red-600" />
            <h3 className="font-semibold text-red-800">Restrictions</h3>
          </div>
          <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
            {instructions.restrictedTopics.filter(Boolean).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h3 className="font-semibold text-slate-900">Escalation Rules</h3>
          </div>
          <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
            {instructions.escalationConditions.filter(Boolean).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={authorized}
            onChange={(e) => setAuthorized(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-700"
          />
          <span className="text-sm text-slate-700">
            <strong>I have reviewed the approved context</strong> and authorize this
            AI-assisted outbound call. I confirm the information above is correct and
            appropriate for disclosure.
          </span>
        </label>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button variant="outline" onClick={onSaveDraft}>
          Save Draft
        </Button>
        <Button
          onClick={onLaunch}
          disabled={!authorized || isLaunching}
          className={cn(!authorized && 'opacity-50')}
        >
          {isLaunching ? 'Launching...' : 'Launch Call'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
