import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));

import { DEFAULT_VOICE_SETTINGS, NOT_AVAILABLE_RESPONSE } from '@outbound-call/shared';
import type { CallMission, MissionType, VoiceSettings } from '@outbound-call/shared';
import { buildPrompt } from '../services/prompt-builder.js';
import {
  clearProvisionalResults,
  getProvisionalResults,
  handleCheckRequiredOutputs,
  handleRecordCollectedField,
} from '../services/grok-tools.js';

const MISSION_ID = '00000000-0000-0000-0000-000000000011';

function makeMission(missionType: MissionType): CallMission {
  return {
    id: MISSION_ID,
    caseId: '00000000-0000-0000-0000-000000000002',
    missionType,
    title: 'Carrier call',
    organizationName: 'State Farm',
    department: null,
    contactName: null,
    destinationPhone: '+15125550100',
    extension: null,
    destinationTimezone: 'America/Chicago',
    goal: 'Open a claim',
    objectives: [],
    successCriteria: [],
    approvedContext: [
      { field: 'client_full_name', label: 'Client', value: 'Jane Doe', included: true },
      { field: 'insured_name', label: 'Insured', value: 'Bob Roe', included: true },
      { field: 'client_role_in_loss', label: 'Role', value: 'passenger', included: true },
      { field: 'client_date_of_birth', label: 'DOB', value: '01/02/1980', included: false },
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

const ctx = (missionType: MissionType = 'open_claim_third_party') => ({
  missionId: MISSION_ID,
  callSessionId: 's1',
  mission: makeMission(missionType),
});

describe('claim call prompt', () => {
  it('third-party prompt names the other driver as the insured, not our client', () => {
    const prompt = buildPrompt(makeMission('open_claim_third_party'), voiceSettings);
    expect(prompt).toContain('THIRD-PARTY claim');
    expect(prompt).toContain("**The carrier's insured:** Bob Roe");
    expect(prompt).toContain('Jane Doe (passenger)');
    expect(prompt).toContain('answer "No."');
  });

  it('first-party prompt treats our client as the insured and asks for UM/UIM', () => {
    const prompt = buildPrompt(makeMission('open_claim_first_party'), voiceSettings);
    expect(prompt).toContain('FIRST-PARTY');
    expect(prompt).toContain('UM/UIM');
    expect(prompt).not.toContain('THIRD-PARTY claim');
  });

  it('enforces minimum disclosure and never leaks an un-approved DOB', () => {
    const prompt = buildPrompt(makeMission('open_claim_third_party'), voiceSettings);
    expect(prompt).toContain(NOT_AVAILABLE_RESPONSE);
    expect(prompt).toContain('Social Security numbers');
    expect(prompt).not.toContain('01/02/1980');
  });

  it('lists every Letter of Representation output and a single final confirmation', () => {
    const prompt = buildPrompt(makeMission('open_claim_third_party'), voiceSettings);
    for (const key of [
      'claim_number',
      'adjuster_name',
      'adjuster_phone',
      'adjuster_fax',
      'adjuster_email',
      'adjuster_mailing_address',
    ]) {
      expect(prompt).toContain(`\`${key}\``);
    }
    expect(prompt).toContain('Single Final Confirmation');
    expect(prompt).not.toContain('digit-by-digit or letter-by-letter');
  });
});

describe('structured capture', () => {
  beforeEach(() => clearProvisionalResults(MISSION_ID));

  const record = (fieldKey: string, value: string, status = 'tentative') =>
    handleRecordCollectedField(
      {
        fieldKey,
        value,
        confirmationStatus: status,
        representativeAttribution: 'rep',
        supportingQuote: '',
      },
      ctx(),
    ).then((r) => JSON.parse(r));

  it('rejects an incomplete email so the agent asks once more', async () => {
    const result = await record('adjuster_email', 'jsmith at statefarm');
    expect(result.status).toBe('invalid');
    expect(getProvisionalResults(MISSION_ID)).toHaveLength(0);
  });

  it('stores normalized values and replaces earlier entries for the same field', async () => {
    await record('claim_number', '53 60 m2');
    await record('claim_number', '53-60M2-24J', 'confirmed');
    const stored = getProvisionalResults(MISSION_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ value: '53-60M2-24J', confirmationStatus: 'confirmed' });
  });

  it('check_required_outputs reports what is still missing', async () => {
    await record('claim_number', '53-60M2-24J');
    await record('adjuster_phone', '512 555 0100');
    const status = JSON.parse(await handleCheckRequiredOutputs({}, ctx()));
    expect(status.missing.map((m: { fieldKey: string }) => m.fieldKey)).toEqual([
      'adjuster_name',
      'adjuster_fax',
      'adjuster_email',
      'adjuster_mailing_address',
    ]);
    expect(status.awaitingFinalConfirmation).toEqual(['claim_number', 'adjuster_phone']);
  });
});
