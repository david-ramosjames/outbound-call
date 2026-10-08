'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Steps } from '@/components/ui/steps';
import { DestinationStep } from '@/components/calls/mission-wizard/destination-step';
import { ContextStep } from '@/components/calls/mission-wizard/context-step';
import { InstructionsStep } from '@/components/calls/mission-wizard/instructions-step';
import { ReviewStep } from '@/components/calls/mission-wizard/review-step';
import { createClient } from '@/lib/supabase/client';
import {
  DEFAULT_VOICE_SETTINGS,
  APPROVED_CONTEXT_FIELDS,
  CONTEXT_FIELD_LABELS,
  MISSION_TEMPLATES_BY_TYPE,
  DEFAULT_INCLUDED_FIELDS_BY_MISSION,
  MISSION_TYPE_LABELS,
  REQUIRED_CLAIM_OUTPUT_FIELDS,
  REQUIRED_CLAIM_OUTPUT_LABELS,
  WITHHELD_BY_DEFAULT_FIELDS,
  claimPartyForMissionType,
} from '@outbound-call/shared';
import type {
  Destination,
  MissionInstructions,
  ApprovedContextEntry,
  MissionType,
} from '@outbound-call/shared';

const WIZARD_STEPS = [
  { title: 'Destination' },
  { title: 'Context' },
  { title: 'Instructions' },
  { title: 'Review' },
];

function buildInstructions(missionType: MissionType): MissionInstructions {
  const template = MISSION_TEMPLATES_BY_TYPE[missionType];
  return {
    goal: template.defaultGoal,
    objectives: [...template.defaultObjectives],
    successCriteria: [...template.defaultSuccessCriteria],
    requiredInformation: [
      ...REQUIRED_CLAIM_OUTPUT_FIELDS.map((f) => REQUIRED_CLAIM_OUTPUT_LABELS[f]),
      'Documents promised / sent',
      'Next steps and follow-up timing',
    ],
    allowedDisclosures: [...template.defaultAllowedDisclosures],
    restrictedTopics: [...template.defaultRestrictedTopics],
    escalationConditions: [...template.defaultEscalationRules],
    additionalInstructions: '',
  };
}

const POLICYHOLDER_STATUS_BY_PARTY = {
  third_party:
    'No — attorney calling on behalf of a claimant against your insured (third party)',
  first_party: 'Attorney calling on behalf of your insured (first party / UM-UIM)',
} as const;

const withheld = new Set<string>(WITHHELD_BY_DEFAULT_FIELDS);

function applyMissionDefaults(
  fields: ApprovedContextEntry[],
  missionType: MissionType,
): ApprovedContextEntry[] {
  const included = new Set(DEFAULT_INCLUDED_FIELDS_BY_MISSION[missionType]);
  const party = claimPartyForMissionType(missionType);
  return fields.map((f) => {
    const next =
      f.field === 'policyholder_status' && party
        ? {
            ...f,
            value: POLICYHOLDER_STATUS_BY_PARTY[party],
            missionSpecificValue: POLICYHOLDER_STATUS_BY_PARTY[party],
          }
        : f;
    return {
      ...next,
      included:
        !withheld.has(f.field) &&
        (included.has(f.field) || Boolean(next.value?.trim())),
    };
  });
}

/** Hardcoded starting values; what staff entered on the previous call takes precedence over these. */
const FIXED_DEFAULT_FIELDS = new Set<string>([
  'law_firm_name',
  'law_firm_phone_number',
  'representation_status',
  'policy_type',
  'incident_type',
  'accident_state',
]);

/** Reviewed call results that answer a context field on the next call. */
const RESULT_TO_CONTEXT: Record<string, ApprovedContextEntry['field']> = {
  claim_number: 'existing_claim_number',
  adjuster_name: 'known_adjuster_name',
  adjuster_phone: 'known_adjuster_phone',
  adjuster_email: 'known_adjuster_email',
};

/**
 * Suggested values from earlier calls on this case: what staff entered on the most recent call, plus claim and
 * adjuster details a reviewer accepted from any earlier call (unreviewed AI extractions are not used).
 */
async function loadPreviousCallValues(
  supabase: ReturnType<typeof createClient>,
  caseId: string,
): Promise<{ values: Record<string, string>; included: Set<string>; sources: Record<string, string> }> {
  const values: Record<string, string> = {};
  const included = new Set<string>();
  const sources: Record<string, string> = {};

  const { data: missions } = await supabase
    .from('call_missions')
    .select('id, organization_name, created_at, approved_context')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (!missions || missions.length === 0) return { values, included, sources };

  const describe = (m: { organization_name?: string | null; created_at: string }) =>
    `previous call${m.organization_name ? ` to ${m.organization_name}` : ''} on ${new Date(m.created_at).toLocaleDateString()}`;

  const latest = missions[0]!;
  for (const row of (latest.approved_context ?? []) as Array<{ field: string; value?: string; included?: boolean }>) {
    const v = row.value?.trim();
    if (!v) continue;
    values[row.field] = v;
    sources[row.field] = describe(latest);
    if (row.included) included.add(row.field);
  }

  const { data: results } = await supabase
    .from('call_results')
    .select('id, call_mission_id')
    .in('call_mission_id', missions.map((m) => m.id));
  if (results && results.length > 0) {
    const missionByResult = new Map(results.map((r) => [r.id, missions.find((m) => m.id === r.call_mission_id)!]));
    const { data: fields } = await supabase
      .from('call_result_fields')
      .select('call_result_id, field_key, extracted_value, reviewed_value, review_status, created_at')
      .in('call_result_id', results.map((r) => r.id))
      .in('review_status', ['accepted', 'edited'])
      .order('created_at', { ascending: false });
    const filled = new Set<string>();
    for (const f of fields ?? []) {
      const target = RESULT_TO_CONTEXT[f.field_key as string];
      const v = String(f.reviewed_value || f.extracted_value || '').trim();
      if (!target || !v || filled.has(target)) continue;
      filled.add(target);
      values[target] = v;
      included.add(target);
      sources[target] = `reviewed result from ${describe(missionByResult.get(f.call_result_id)!)}`;
    }
  }

  return { values, included, sources };
}

export default function NewCallPage() {
  const params = useParams<{ caseId: string }>();
  const router = useRouter();
  const caseId = params.caseId;

  const [currentStep, setCurrentStep] = useState(0);
  const [isLaunching, setIsLaunching] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [missionType, setMissionType] = useState<MissionType>('open_claim_third_party');

  const [destination, setDestination] = useState<Partial<Destination>>({
    organizationName: '',
    department: 'Claims',
    contactName: '',
    phoneNumber: '',
    extension: '',
    destinationTimezone: 'America/Chicago',
  });

  const [contextFields, setContextFields] = useState<ApprovedContextEntry[]>(
    () =>
      applyMissionDefaults(
        APPROVED_CONTEXT_FIELDS.map((field) => ({
          field,
          label: CONTEXT_FIELD_LABELS[field],
          value: '',
          included: false,
        })),
        'open_claim_third_party',
      ),
  );

  const [suggestions, setSuggestions] = useState<Record<string, string>>({});

  const [instructions, setInstructions] = useState<MissionInstructions>(() =>
    buildInstructions('open_claim_third_party'),
  );

  const loadCaseData = useCallback(async () => {
    const supabase = createClient();

    const [{ data: caseData }, { data: trackerData }] = await Promise.all([
      supabase.from('cases').select('*').eq('id', caseId).single(),
      supabase
        .from('case_tracker_entries')
        .select('attorney_name, client_phone')
        .eq('case_id', caseId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),
    ]);

    if (!caseData) return;

    const clientFullName =
      caseData.client_name ||
      [caseData.client_first_name, caseData.client_last_name]
        .filter(Boolean)
        .join(' ');

    const mappedValues: Record<string, string | null | undefined> = {
      client_full_name: clientFullName,
      client_date_of_birth: caseData.date_of_birth,
      client_phone_number: trackerData?.client_phone || caseData.client_phone,
      date_of_loss: caseData.date_of_incident,
      case_type: caseData.case_type,
      attorney_name: trackerData?.attorney_name,
      law_firm_name: 'Ramos James Law',
      law_firm_phone_number: '(512) 537-3369',
      representation_status: 'Firm represents the client',
      policy_type: 'auto',
      incident_type: 'accident',
      accident_state: 'Texas',
    };

    const previous = await loadPreviousCallValues(supabase, caseId);
    setSuggestions(
      Object.fromEntries(
        Object.entries(previous.sources).filter(([field]) => !mappedValues[field] || FIXED_DEFAULT_FIELDS.has(field)),
      ),
    );

    setContextFields((prev) =>
      applyMissionDefaults(
        prev.map((f) => {
          const fromPrevious = previous.values[f.field];
          const mapped = FIXED_DEFAULT_FIELDS.has(f.field) && fromPrevious ? fromPrevious : mappedValues[f.field];
          const value = mapped ? String(mapped) : f.value || fromPrevious || '';
          return {
            ...f,
            value,
            missionSpecificValue: f.missionSpecificValue ?? (value || undefined),
          };
        }),
        missionType,
      ).map((f) =>
        // Carry forward only what staff shared last time; other suggested values start off.
        f.field in previous.values && (!mappedValues[f.field] || FIXED_DEFAULT_FIELDS.has(f.field))
          ? { ...f, included: previous.included.has(f.field) && !withheld.has(f.field) }
          : f,
      ),
    );
  }, [caseId, missionType]);

  useEffect(() => {
    loadCaseData();
  }, [loadCaseData]);

  const handleMissionTypeChange = (next: MissionType) => {
    setMissionType(next);
    setInstructions(buildInstructions(next));
    setContextFields((prev) => applyMissionDefaults(prev, next));
  };

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === 0) {
      if (!destination.organizationName?.trim()) {
        newErrors.organizationName = 'Organization name is required';
      }
      if (!destination.phoneNumber?.trim()) {
        newErrors.phoneNumber = 'Phone number is required';
      } else if (destination.phoneNumber.replace(/\D/g, '').length < 10) {
        newErrors.phoneNumber = 'Enter a valid phone number';
      }
    }

    if (step === 2) {
      if (!instructions.goal.trim()) {
        newErrors.goal = 'Goal is required';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const goNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((s) => Math.min(s + 1, 3));
    }
  };

  const goBack = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const handleDestinationChange = (field: keyof Destination, value: string) => {
    setDestination((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleToggleField = (index: number) => {
    setContextFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, included: !f.included } : f)),
    );
  };

  const handleUpdateFieldValue = (index: number, value: string) => {
    setContextFields((prev) =>
      prev.map((f, i) =>
        i === index
          ? {
              ...f,
              missionSpecificValue: value,
              // Typing a value authorizes disclosure; clearing turns it off unless still toggled
              included: value.trim().length > 0 ? true : f.included,
            }
          : f,
      ),
    );
  };

  const handleInstructionsChange = <K extends keyof MissionInstructions>(
    field: K,
    value: MissionInstructions[K],
  ) => {
    setInstructions((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const includedContext = contextFields
    .filter((f) => f.included)
    .map((f) => ({
      ...f,
      value: f.missionSpecificValue?.trim() || f.value,
      missionSpecificValue: f.missionSpecificValue,
    }));

  const handleSaveDraft = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('call_missions').insert({
      case_id: caseId,
      mission_type: missionType,
      title: `${MISSION_TYPE_LABELS[missionType]} - ${destination.organizationName}`,
      organization_name: destination.organizationName,
      department: destination.department || null,
      contact_name: destination.contactName || null,
      destination_phone: destination.phoneNumber,
      extension: destination.extension || null,
      destination_timezone: destination.destinationTimezone || 'America/Chicago',
      goal: instructions.goal,
      objectives: instructions.objectives,
      success_criteria: instructions.successCriteria,
      approved_context: includedContext,
      allowed_disclosures: instructions.allowedDisclosures,
      restricted_topics: instructions.restrictedTopics,
      escalation_rules: instructions.escalationConditions,
      status: 'draft',
      created_by: user.id,
    });

    router.push(`/cases/${caseId}/calls`);
  };

  const launchCall = async (callingHoursOverride: boolean) => {
    setIsLaunching(true);
    try {
      const response = await fetch('/api/calls/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId,
          missionType,
          destination,
          contextFields: includedContext,
          instructions,
          callingHoursOverride,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();

        if (
          errorData.code === 'OUTSIDE_CALLING_HOURS' &&
          errorData.canOverride === true &&
          !callingHoursOverride
        ) {
          const hours = errorData.allowedHours;
          const confirmed = window.confirm(
            `This destination is outside the configured calling hours` +
              (hours
                ? ` (${hours.startTime}–${hours.endTime} ${hours.timezone})`
                : '') +
              '.\n\nCall anyway? This override will be recorded.',
          );

          if (confirmed) {
            await launchCall(true);
            return;
          }

          setIsLaunching(false);
          return;
        }

        alert(errorData.error ?? 'Failed to launch call');
        setIsLaunching(false);
        return;
      }

      const { missionId } = await response.json();
      router.push(`/cases/${caseId}/calls/${missionId}`);
    } catch {
      alert('Network error. Please try again.');
      setIsLaunching(false);
    }
  };

  const handleLaunch = () => {
    void launchCall(false);
  };

  const handleCancel = () => {
    router.push(`/cases/${caseId}/calls`);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link
          href={`/cases/${caseId}/calls`}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">New AI Call</h1>
          <p className="text-sm text-slate-500">
            Configure and launch an AI-assisted outbound call
          </p>
        </div>
      </div>

      <Steps steps={WIZARD_STEPS} currentStep={currentStep} />

      <div className="max-w-3xl">
        {currentStep === 0 && (
          <DestinationStep
            data={destination}
            missionType={missionType}
            errors={errors}
            onChange={handleDestinationChange}
            onMissionTypeChange={handleMissionTypeChange}
          />
        )}
        {currentStep === 1 && (
          <ContextStep
            contextFields={contextFields}
            onToggleField={handleToggleField}
            onUpdateValue={handleUpdateFieldValue}
            suggestions={suggestions}
          />
        )}
        {currentStep === 2 && (
          <InstructionsStep
            data={instructions}
            errors={errors}
            onChange={handleInstructionsChange}
          />
        )}
        {currentStep === 3 && (
          <ReviewStep
            destination={destination}
            contextFields={contextFields}
            instructions={instructions}
            aiDisclosureText={DEFAULT_VOICE_SETTINGS.aiDisclosureText}
            onSaveDraft={handleSaveDraft}
            onLaunch={handleLaunch}
            onCancel={handleCancel}
            isLaunching={isLaunching}
          />
        )}

        {currentStep < 3 && (
          <div className="flex items-center gap-3 mt-8 pt-6 border-t border-slate-200">
            {currentStep > 0 && (
              <Button variant="outline" onClick={goBack}>
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back
              </Button>
            )}
            <Button onClick={goNext}>
              Next
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
