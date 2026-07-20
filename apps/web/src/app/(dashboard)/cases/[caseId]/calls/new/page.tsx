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
  OPEN_INSURANCE_CLAIM_TEMPLATE,
  DEFAULT_VOICE_SETTINGS,
  APPROVED_CONTEXT_FIELDS,
} from '@outbound-call/shared';
import type {
  Destination,
  MissionInstructions,
  ApprovedContextEntry,
} from '@outbound-call/shared';

const WIZARD_STEPS = [
  { title: 'Destination' },
  { title: 'Context' },
  { title: 'Instructions' },
  { title: 'Review' },
];

const FIELD_LABELS: Record<string, string> = {
  client_full_name: 'Client Full Name',
  client_date_of_birth: 'Client Date of Birth',
  client_address: 'Client Address',
  client_phone_number: 'Client Phone Number',
  injuries: 'Injuries',
  date_of_loss: 'Date of Loss',
  time_of_loss: 'Time of Loss',
  location_of_loss: 'Location of Loss',
  case_type: 'Case Type',
  brief_incident_description: 'Brief Incident Description',
  insured_name: 'Insured Name',
  insurance_carrier: 'Insurance Carrier',
  policy_number: 'Policy Number',
  existing_claim_number: 'Existing Claim Number',
  vehicle_year: 'Vehicle Year',
  vehicle_make: 'Vehicle Make',
  vehicle_model: 'Vehicle Model',
  vehicle_identification_number: 'VIN',
  police_report_number: 'Police Report Number',
  attorney_name: 'Attorney Name',
  law_firm_name: 'Law Firm Name',
  law_firm_phone_number: 'Law Firm Phone',
  law_firm_email_address: 'Law Firm Email',
  law_firm_mailing_address: 'Law Firm Address',
  representation_status: 'Representation Status',
  other_approved_notes: 'Other Approved Notes',
};

export default function NewCallPage() {
  const params = useParams<{ caseId: string }>();
  const router = useRouter();
  const caseId = params.caseId;

  const [currentStep, setCurrentStep] = useState(0);
  const [isLaunching, setIsLaunching] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [destination, setDestination] = useState<Partial<Destination>>({
    organizationName: '',
    department: '',
    contactName: '',
    phoneNumber: '',
    extension: '',
    destinationTimezone: 'America/Chicago',
  });

  const [contextFields, setContextFields] = useState<ApprovedContextEntry[]>(
    APPROVED_CONTEXT_FIELDS.map((field) => ({
      field,
      label: FIELD_LABELS[field] ?? field.replace(/_/g, ' '),
      value: '',
      included: false,
    })),
  );

  const [instructions, setInstructions] = useState<MissionInstructions>({
    goal: OPEN_INSURANCE_CLAIM_TEMPLATE.defaultGoal,
    objectives: [...OPEN_INSURANCE_CLAIM_TEMPLATE.defaultObjectives],
    successCriteria: [...OPEN_INSURANCE_CLAIM_TEMPLATE.defaultSuccessCriteria],
    requiredInformation: [
      'Claim number',
      'Adjuster name',
      'Adjuster phone number',
      'Adjuster email address',
      'Fax number or mailing address',
      'Requested documents',
      'Next steps',
    ],
    allowedDisclosures: [...OPEN_INSURANCE_CLAIM_TEMPLATE.defaultAllowedDisclosures],
    restrictedTopics: [...OPEN_INSURANCE_CLAIM_TEMPLATE.defaultRestrictedTopics],
    escalationConditions: [...OPEN_INSURANCE_CLAIM_TEMPLATE.defaultEscalationRules],
    additionalInstructions: '',
  });

  const loadCaseData = useCallback(async () => {
    const supabase = createClient();

    const [{ data: caseData }, { data: trackerData }] = await Promise.all([
      supabase.from('cases').select('*').eq('id', caseId).single(),
      supabase
        .from('case_tracker_entries')
        .select('injuries, case_description, attorney_name, client_phone')
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

    // Map approved-context fields to actual Case Tracker columns
    const mappedValues: Record<string, string | null | undefined> = {
      client_full_name: clientFullName,
      client_date_of_birth: caseData.date_of_birth,
      client_phone_number: trackerData?.client_phone || caseData.client_phone,
      date_of_loss: caseData.date_of_incident,
      case_type: caseData.case_type,
      brief_incident_description: trackerData?.case_description ?? caseData.notes,
      injuries: trackerData?.injuries,
      attorney_name: trackerData?.attorney_name,
      law_firm_name: 'Ramos James Law',
    };

    setContextFields((prev) =>
      prev.map((f) => {
        const mapped = mappedValues[f.field];
        const direct = caseData[f.field];
        const value = mapped ?? direct;
        return { ...f, value: value ? String(value) : '' };
      }),
    );
  }, [caseId]);

  useEffect(() => {
    loadCaseData();
  }, [loadCaseData]);

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
        i === index ? { ...f, missionSpecificValue: value } : f,
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

  const handleSaveDraft = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('call_missions').insert({
      case_id: caseId,
      mission_type: 'open_insurance_claim',
      title: `Open Claim - ${destination.organizationName}`,
      organization_name: destination.organizationName,
      department: destination.department || null,
      contact_name: destination.contactName || null,
      destination_phone: destination.phoneNumber,
      extension: destination.extension || null,
      destination_timezone: destination.destinationTimezone || 'America/Chicago',
      goal: instructions.goal,
      objectives: instructions.objectives,
      success_criteria: instructions.successCriteria,
      approved_context: contextFields.filter((f) => f.included),
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
          destination,
          contextFields: contextFields.filter((f) => f.included),
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
            errors={errors}
            onChange={handleDestinationChange}
          />
        )}
        {currentStep === 1 && (
          <ContextStep
            contextFields={contextFields}
            onToggleField={handleToggleField}
            onUpdateValue={handleUpdateFieldValue}
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
