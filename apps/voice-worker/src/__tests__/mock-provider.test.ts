import { describe, it, expect } from 'vitest';

const MOCK_SCENARIOS = [
  'claim_opened_successfully',
  'existing_claim_found',
  'missing_policy_number',
  'police_report_requested',
  'adjuster_assigned',
  'no_adjuster_assigned',
  'voicemail',
  'ai_interaction_refused',
  'recorded_statement_requested',
  'call_disconnected',
  'invalid_phone_number',
  'xai_websocket_failure',
  'twilio_initiation_failure',
  'hold_timeout',
] as const;

type MockScenario = (typeof MOCK_SCENARIOS)[number];

interface MockScenarioConfig {
  scenario: MockScenario;
  expectedOutcome: string;
  expectedStatuses: string[];
  generatesTranscript: boolean;
  generatesResults: boolean;
}

const SCENARIO_CONFIGS: Record<MockScenario, MockScenarioConfig> = {
  claim_opened_successfully: {
    scenario: 'claim_opened_successfully',
    expectedOutcome: 'success',
    expectedStatuses: ['initiating', 'dialing', 'ringing', 'answered', 'in_progress', 'completed'],
    generatesTranscript: true,
    generatesResults: true,
  },
  existing_claim_found: {
    scenario: 'existing_claim_found',
    expectedOutcome: 'partial_success',
    expectedStatuses: ['initiating', 'dialing', 'ringing', 'answered', 'in_progress', 'completed'],
    generatesTranscript: true,
    generatesResults: true,
  },
  missing_policy_number: {
    scenario: 'missing_policy_number',
    expectedOutcome: 'partial_success',
    expectedStatuses: ['initiating', 'dialing', 'ringing', 'answered', 'in_progress', 'completed'],
    generatesTranscript: true,
    generatesResults: true,
  },
  police_report_requested: {
    scenario: 'police_report_requested',
    expectedOutcome: 'partial_success',
    expectedStatuses: ['initiating', 'dialing', 'ringing', 'answered', 'in_progress', 'completed'],
    generatesTranscript: true,
    generatesResults: true,
  },
  adjuster_assigned: {
    scenario: 'adjuster_assigned',
    expectedOutcome: 'success',
    expectedStatuses: ['initiating', 'dialing', 'ringing', 'answered', 'in_progress', 'completed'],
    generatesTranscript: true,
    generatesResults: true,
  },
  no_adjuster_assigned: {
    scenario: 'no_adjuster_assigned',
    expectedOutcome: 'partial_success',
    expectedStatuses: ['initiating', 'dialing', 'ringing', 'answered', 'in_progress', 'completed'],
    generatesTranscript: true,
    generatesResults: true,
  },
  voicemail: {
    scenario: 'voicemail',
    expectedOutcome: 'failure',
    expectedStatuses: ['initiating', 'dialing', 'ringing', 'answered', 'completed'],
    generatesTranscript: false,
    generatesResults: true,
  },
  ai_interaction_refused: {
    scenario: 'ai_interaction_refused',
    expectedOutcome: 'failure',
    expectedStatuses: ['initiating', 'dialing', 'ringing', 'answered', 'in_progress', 'completed'],
    generatesTranscript: true,
    generatesResults: true,
  },
  recorded_statement_requested: {
    scenario: 'recorded_statement_requested',
    expectedOutcome: 'human_follow_up',
    expectedStatuses: ['initiating', 'dialing', 'ringing', 'answered', 'in_progress', 'completed'],
    generatesTranscript: true,
    generatesResults: true,
  },
  call_disconnected: {
    scenario: 'call_disconnected',
    expectedOutcome: 'failure',
    expectedStatuses: ['initiating', 'dialing', 'ringing', 'answered', 'in_progress', 'failed'],
    generatesTranscript: true,
    generatesResults: true,
  },
  invalid_phone_number: {
    scenario: 'invalid_phone_number',
    expectedOutcome: 'failure',
    expectedStatuses: ['initiating', 'failed'],
    generatesTranscript: false,
    generatesResults: true,
  },
  xai_websocket_failure: {
    scenario: 'xai_websocket_failure',
    expectedOutcome: 'failure',
    expectedStatuses: ['initiating', 'dialing', 'ringing', 'answered', 'failed'],
    generatesTranscript: false,
    generatesResults: true,
  },
  twilio_initiation_failure: {
    scenario: 'twilio_initiation_failure',
    expectedOutcome: 'failure',
    expectedStatuses: ['initiating', 'failed'],
    generatesTranscript: false,
    generatesResults: true,
  },
  hold_timeout: {
    scenario: 'hold_timeout',
    expectedOutcome: 'failure',
    expectedStatuses: ['initiating', 'dialing', 'ringing', 'answered', 'in_progress', 'on_hold', 'failed'],
    generatesTranscript: true,
    generatesResults: true,
  },
};

describe('Mock Scenarios', () => {
  it('has all 14 defined scenarios', () => {
    expect(MOCK_SCENARIOS).toHaveLength(14);
  });

  for (const scenario of MOCK_SCENARIOS) {
    describe(scenario, () => {
      const config = SCENARIO_CONFIGS[scenario];

      it('has a valid configuration', () => {
        expect(config).toBeDefined();
        expect(config.expectedStatuses.length).toBeGreaterThan(0);
      });

      it('starts with initiating', () => {
        expect(config.expectedStatuses[0]).toBe('initiating');
      });

      it('ends with a terminal status', () => {
        const lastStatus = config.expectedStatuses[config.expectedStatuses.length - 1];
        expect(['completed', 'failed', 'cancelled']).toContain(lastStatus);
      });

      it('has a valid outcome', () => {
        expect(['success', 'partial_success', 'failure', 'human_follow_up']).toContain(
          config.expectedOutcome
        );
      });

      it('always generates results', () => {
        expect(config.generatesResults).toBe(true);
      });
    });
  }
});
