import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));

import {
  BODILY_INJURY_LIABILITY_REFUSAL,
  DEFAULT_VOICE_SETTINGS,
  isNeverDisclosedField,
  APPROVED_CONTEXT_FIELDS,
} from '@outbound-call/shared';
import type { CallMission, VoiceSettings } from '@outbound-call/shared';
import { buildPrompt } from '../services/prompt-builder.js';
import { handleGetApprovedCaseField } from '../services/grok-tools.js';

const MISSION_ID = '00000000-0000-0000-0000-000000000001';

function makeMission(): CallMission {
  return {
    id: MISSION_ID,
    caseId: '00000000-0000-0000-0000-000000000002',
    missionType: 'open_insurance_claim',
    title: 'State Farm call',
    organizationName: 'State Farm',
    department: null,
    contactName: null,
    destinationPhone: '+15125550100',
    extension: null,
    destinationTimezone: 'America/Chicago',
    goal: 'Open a claim',
    objectives: ['Get claim number'],
    successCriteria: ['Claim number obtained'],
    approvedContext: [
      { field: 'client_full_name', label: 'Client Name', value: 'Jane Doe', included: true },
      { field: 'injuries', label: 'Injuries', value: 'neck and back pain', included: true },
      { field: 'fault_or_liability', label: 'Fault', value: 'other driver ran red light', included: true },
    ],
    allowedDisclosures: [],
    restrictedTopics: [],
    escalationRules: [],
    expectedOutputSchema: null,
    promptSnapshot: null,
    authorizationSnapshot: null,
    correlationToken: null,
    status: 'in_progress',
    outcome: null,
    createdBy: '00000000-0000-0000-0000-000000000003',
    authorizedBy: null,
    authorizedAt: null,
    startedAt: null,
    answeredAt: null,
    completedAt: null,
    durationSeconds: null,
    holdDurationSeconds: null,
    failureReason: null,
    createdAt: '',
    updatedAt: '',
  };
}

const voiceSettings: VoiceSettings = {
  id: '00000000-0000-0000-0000-000000000000',
  ...DEFAULT_VOICE_SETTINGS,
  createdAt: '',
  updatedAt: '',
};

describe('medical / liability guard', () => {
  it('never offers injuries as an approved context field', () => {
    expect((APPROVED_CONTEXT_FIELDS as readonly string[]).includes('injuries')).toBe(false);
    expect(APPROVED_CONTEXT_FIELDS.some((f) => isNeverDisclosedField(f))).toBe(false);
  });

  it('prompt includes the absolute prohibition and refusal script', () => {
    const prompt = buildPrompt(makeMission(), voiceSettings);
    expect(prompt).toContain('ABSOLUTE PROHIBITION');
    expect(prompt).toContain(BODILY_INJURY_LIABILITY_REFUSAL);
    expect(prompt).toContain('"no injuries,"');
  });

  it('prompt drops restricted values even if a stored mission marks them included', () => {
    const prompt = buildPrompt(makeMission(), voiceSettings);
    expect(prompt).toContain('Jane Doe');
    expect(prompt).not.toContain('neck and back pain');
    expect(prompt).not.toContain('ran red light');
  });

  it('get_approved_case_field refuses restricted fields', async () => {
    const result = JSON.parse(
      await handleGetApprovedCaseField(
        { missionId: MISSION_ID, fieldKey: 'injuries' },
        { missionId: MISSION_ID, callSessionId: 's1', mission: makeMission() },
      ),
    );
    expect(result.error).toBe('field_never_disclosed');
    expect(JSON.stringify(result)).not.toContain('neck');
  });
});
