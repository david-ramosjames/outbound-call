import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import type { CallMission } from '@outbound-call/shared';

export type MockScenario =
  | 'claim_opened_successfully'
  | 'existing_claim_found'
  | 'missing_policy_number'
  | 'police_report_requested'
  | 'adjuster_assigned'
  | 'no_adjuster_assigned'
  | 'voicemail'
  | 'ai_interaction_refused'
  | 'recorded_statement_requested'
  | 'call_disconnected'
  | 'invalid_phone_number'
  | 'xai_websocket_failure'
  | 'twilio_initiation_failure'
  | 'hold_timeout';

export const MOCK_SCENARIOS: MockScenario[] = [
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
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockCallProvider {
  private activeScenario: MockScenario = 'claim_opened_successfully';

  setScenario(scenario: MockScenario): void {
    this.activeScenario = scenario;
  }

  getScenario(): MockScenario {
    return this.activeScenario;
  }

  async simulateCall(
    mission: CallMission,
    callSessionId: string,
    scenario?: MockScenario
  ): Promise<void> {
    const sc = scenario ?? this.activeScenario;
    const missionId = mission.id;
    const ctx = { missionId, callSessionId };

    logger.mock(`Starting scenario: ${sc}`, ctx);

    try {
      switch (sc) {
        case 'claim_opened_successfully':
          await this.scenarioClaimOpened(missionId, callSessionId);
          break;
        case 'existing_claim_found':
          await this.scenarioExistingClaim(missionId, callSessionId);
          break;
        case 'missing_policy_number':
          await this.scenarioMissingPolicy(missionId, callSessionId);
          break;
        case 'police_report_requested':
          await this.scenarioPoliceReport(missionId, callSessionId);
          break;
        case 'adjuster_assigned':
          await this.scenarioAdjusterAssigned(missionId, callSessionId);
          break;
        case 'no_adjuster_assigned':
          await this.scenarioNoAdjuster(missionId, callSessionId);
          break;
        case 'voicemail':
          await this.scenarioVoicemail(missionId, callSessionId);
          break;
        case 'ai_interaction_refused':
          await this.scenarioAiRefused(missionId, callSessionId);
          break;
        case 'recorded_statement_requested':
          await this.scenarioRecordedStatement(missionId, callSessionId);
          break;
        case 'call_disconnected':
          await this.scenarioDisconnected(missionId, callSessionId);
          break;
        case 'invalid_phone_number':
          await this.scenarioInvalidPhone(missionId, callSessionId);
          break;
        case 'xai_websocket_failure':
          await this.scenarioXaiFailure(missionId, callSessionId);
          break;
        case 'twilio_initiation_failure':
          await this.scenarioTwilioFailure(missionId, callSessionId);
          break;
        case 'hold_timeout':
          await this.scenarioHoldTimeout(missionId, callSessionId);
          break;
      }
    } catch (err) {
      logger.error('Mock scenario failed unexpectedly', {
        ...ctx,
        error: err,
      });
    }

    logger.mock(`Scenario "${sc}" completed`, ctx);
  }

  // --- Helpers ---

  private async emitStatus(missionId: string, status: string): Promise<void> {
    await supabase
      .from('call_missions')
      .update({ status })
      .eq('id', missionId);
  }

  private async emitEvent(
    missionId: string,
    callSessionId: string,
    eventType: string,
    payload?: Record<string, unknown>
  ): Promise<void> {
    await supabase.from('call_events').insert({
      id: uuidv4(),
      call_mission_id: missionId,
      call_session_id: callSessionId,
      source: 'mock',
      event_type: eventType,
      event_payload: payload ?? null,
      occurred_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      sequence_number: Date.now(),
    });
  }

  private async emitTranscript(
    missionId: string,
    callSessionId: string,
    speaker: string,
    text: string,
    seq: number
  ): Promise<void> {
    const now = Date.now();
    await supabase.from('call_transcript_segments').insert({
      id: uuidv4(),
      call_mission_id: missionId,
      call_session_id: callSessionId,
      speaker,
      text,
      start_time_ms: now - 2000,
      end_time_ms: now,
      sequence_number: seq,
      is_final: true,
    });
  }

  private async runDialSequence(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.emitStatus(missionId, 'dialing');
    await this.emitEvent(missionId, callSessionId, 'dialing');
    await sleep(1500);

    await this.emitStatus(missionId, 'ringing');
    await this.emitEvent(missionId, callSessionId, 'ringing');
    await sleep(2000);

    await this.emitStatus(missionId, 'answered');
    await this.emitEvent(missionId, callSessionId, 'answered');
    await supabase
      .from('call_missions')
      .update({ answered_at: new Date().toISOString() })
      .eq('id', missionId);
    await sleep(1000);

    await this.emitStatus(missionId, 'in_progress');
    await this.emitEvent(missionId, callSessionId, 'xai_websocket_connected');
    await this.emitEvent(missionId, callSessionId, 'agent_session_configured');
  }

  private async completeCall(
    missionId: string,
    callSessionId: string,
    outcome: string,
    summary: string,
    structuredResults: Record<string, unknown>
  ): Promise<void> {
    await this.emitEvent(missionId, callSessionId, 'call_completed', {
      outcome,
      summary,
    });

    await supabase
      .from('call_missions')
      .update({
        status: 'awaiting_review',
        outcome,
        completed_at: new Date().toISOString(),
        duration_seconds: Math.floor(Math.random() * 300) + 60,
      })
      .eq('id', missionId);

    await supabase.from('call_results').insert({
      id: uuidv4(),
      call_mission_id: missionId,
      mission_outcome: outcome,
      completion_status: outcome,
      summary,
      structured_results: structuredResults,
      requested_documents: [],
      missing_information: [],
      commitments: [],
      deadlines: [],
    });

    await supabase
      .from('call_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', callSessionId);
  }

  private async failCall(
    missionId: string,
    callSessionId: string,
    reason: string
  ): Promise<void> {
    await this.emitEvent(missionId, callSessionId, 'call_failed', { reason });
    await supabase
      .from('call_missions')
      .update({
        status: 'failed',
        outcome: 'failure',
        failure_reason: reason,
        completed_at: new Date().toISOString(),
      })
      .eq('id', missionId);

    await supabase
      .from('call_sessions')
      .update({
        ended_at: new Date().toISOString(),
        disconnect_reason: reason,
      })
      .eq('id', callSessionId);
  }

  // --- Scenarios ---

  private async scenarioClaimOpened(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.runDialSequence(missionId, callSessionId);

    let seq = 1;
    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Hello, I'm an AI-assisted calling agent contacting you on behalf of Ramos James Law regarding a client insurance matter. I'd like to open a new bodily-injury claim.", seq++);
    await sleep(2000);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "Sure, I can help you with that. Can you provide me with the policy number and date of loss?", seq++);
    await sleep(1500);

    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Yes, the policy number is ABC-12345 and the date of loss is January 15, 2025.", seq++);
    await sleep(2000);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "Thank you. I've opened claim number CLM-2025-78901. The assigned adjuster is Sarah Johnson. Her direct line is 512-555-0147 and her email is sjohnson@insurance.example.com.", seq++);
    await sleep(1500);

    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Let me confirm: claim number CLM-2025-78901, adjuster Sarah Johnson, phone 512-555-0147, email sjohnson@insurance.example.com. Is that correct?", seq++);
    await sleep(1000);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "That's correct. Is there anything else I can help you with?", seq++);
    await sleep(1000);

    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "No, that covers everything. Thank you for your help today.", seq++);

    await this.completeCall(missionId, callSessionId, 'success',
      'Claim CLM-2025-78901 opened successfully. Adjuster Sarah Johnson assigned.', {
        missionOutcome: 'success',
        claimOpened: true,
        existingClaimLocated: false,
        claimNumber: 'CLM-2025-78901',
        representativeName: 'Claims Agent',
        adjusterName: 'Sarah Johnson',
        adjusterPhone: '512-555-0147',
        adjusterEmail: 'sjohnson@insurance.example.com',
        requestedDocuments: [],
        missingInformation: [],
        commitments: [],
        deadlines: [],
        summary: 'Claim opened successfully with adjuster assigned.',
        confidence: { claimNumber: 1.0, adjusterName: 1.0, adjusterPhone: 1.0, adjusterEmail: 1.0 },
        evidence: {},
      });
  }

  private async scenarioExistingClaim(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.runDialSequence(missionId, callSessionId);

    let seq = 1;
    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Hello, I'm an AI-assisted calling agent contacting you on behalf of Ramos James Law. I'd like to open a new claim.", seq++);
    await sleep(2000);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "I see we already have an existing claim for this incident under claim number CLM-2025-55432. Would you like me to pull that up?", seq++);
    await sleep(1500);

    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Yes, that would be helpful. Can you provide the adjuster information for that claim?", seq++);
    await sleep(2000);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "The adjuster is Mike Davis at 512-555-0199.", seq++);

    await this.completeCall(missionId, callSessionId, 'success',
      'Existing claim CLM-2025-55432 located. Adjuster Mike Davis assigned.', {
        missionOutcome: 'success',
        claimOpened: false,
        existingClaimLocated: true,
        claimNumber: 'CLM-2025-55432',
        representativeName: 'Claims Agent',
        adjusterName: 'Mike Davis',
        adjusterPhone: '512-555-0199',
        adjusterEmail: null,
        requestedDocuments: [],
        missingInformation: [],
        commitments: [],
        deadlines: [],
        summary: 'Existing claim found. Adjuster information obtained.',
        confidence: { claimNumber: 1.0, adjusterName: 1.0, adjusterPhone: 1.0 },
        evidence: {},
      });
  }

  private async scenarioMissingPolicy(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.runDialSequence(missionId, callSessionId);

    let seq = 1;
    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Hello, I'm an AI-assisted calling agent for Ramos James Law. I'd like to open a new claim.", seq++);
    await sleep(2000);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "I'll need the policy number to proceed. Can you provide that?", seq++);
    await sleep(1500);

    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "I don't have the policy number available at this time. Is there another way we can locate the policy?", seq++);
    await sleep(2000);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "Without a policy number, we can try using the insured's name and date of loss, but I cannot guarantee we'll find it.", seq++);

    await this.completeCall(missionId, callSessionId, 'partial_success',
      'Could not open claim — policy number unavailable. Rep suggested using insured name + date of loss.', {
        missionOutcome: 'partial_success',
        claimOpened: false,
        existingClaimLocated: false,
        claimNumber: null,
        representativeName: 'Claims Agent',
        adjusterName: null,
        adjusterPhone: null,
        adjusterEmail: null,
        requestedDocuments: [],
        missingInformation: [{ field: 'policy_number', reason: 'Not included in approved context', effect: 'Cannot open claim without it', suggestedNextStep: 'Attorney to provide policy number' }],
        commitments: [],
        deadlines: [],
        summary: 'Policy number required but not available.',
        confidence: {},
        evidence: {},
      });
  }

  private async scenarioPoliceReport(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.runDialSequence(missionId, callSessionId);

    let seq = 1;
    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Hello, I'm an AI-assisted calling agent for Ramos James Law. I'd like to open a claim.", seq++);
    await sleep(2000);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "I've started the claim. I'll need a copy of the police report faxed to 512-555-0300 within 10 business days. The claim number is CLM-2025-66001.", seq++);

    await this.completeCall(missionId, callSessionId, 'success',
      'Claim CLM-2025-66001 opened. Police report requested via fax.', {
        missionOutcome: 'success',
        claimOpened: true,
        existingClaimLocated: false,
        claimNumber: 'CLM-2025-66001',
        representativeName: 'Claims Agent',
        adjusterName: null,
        adjusterPhone: null,
        adjusterEmail: null,
        requestedDocuments: [{ documentName: 'Police Report', deliveryMethod: 'fax', destination: '512-555-0300', deadline: '10 business days' }],
        missingInformation: [],
        commitments: ['Fax police report within 10 business days'],
        deadlines: [{ description: 'Police report due', date: '10 business days' }],
        summary: 'Claim opened. Police report requested.',
        confidence: { claimNumber: 1.0 },
        evidence: {},
      });
  }

  private async scenarioAdjusterAssigned(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.runDialSequence(missionId, callSessionId);

    let seq = 1;
    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Hello, I'm calling on behalf of Ramos James Law to open a new claim.", seq++);
    await sleep(2000);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "Claim CLM-2025-77002 is now open. Your adjuster is Jennifer Lee, phone 512-555-0222, email jlee@carrier.example.com. Our fax number is 512-555-0333.", seq++);

    await this.completeCall(missionId, callSessionId, 'success',
      'Claim CLM-2025-77002 opened. Full adjuster details obtained.', {
        missionOutcome: 'success',
        claimOpened: true,
        existingClaimLocated: false,
        claimNumber: 'CLM-2025-77002',
        representativeName: 'Claims Agent',
        adjusterName: 'Jennifer Lee',
        adjusterPhone: '512-555-0222',
        adjusterEmail: 'jlee@carrier.example.com',
        carrierFax: '512-555-0333',
        requestedDocuments: [],
        missingInformation: [],
        commitments: [],
        deadlines: [],
        summary: 'Claim opened with full adjuster info.',
        confidence: { claimNumber: 1.0, adjusterName: 1.0, adjusterPhone: 1.0, adjusterEmail: 1.0, carrierFax: 1.0 },
        evidence: {},
      });
  }

  private async scenarioNoAdjuster(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.runDialSequence(missionId, callSessionId);

    let seq = 1;
    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "I'm calling to open a claim on behalf of Ramos James Law.", seq++);
    await sleep(2000);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "Claim CLM-2025-88003 is open. No adjuster has been assigned yet. One should be assigned within 3–5 business days. You can call back then.", seq++);

    await this.completeCall(missionId, callSessionId, 'partial_success',
      'Claim CLM-2025-88003 opened but no adjuster assigned yet.', {
        missionOutcome: 'partial_success',
        claimOpened: true,
        existingClaimLocated: false,
        claimNumber: 'CLM-2025-88003',
        representativeName: 'Claims Agent',
        adjusterName: null,
        adjusterPhone: null,
        adjusterEmail: null,
        requestedDocuments: [],
        missingInformation: [{ field: 'adjuster_info', reason: 'Not yet assigned', effect: 'Cannot proceed with adjuster contact', suggestedNextStep: 'Follow up in 3-5 business days' }],
        commitments: [],
        deadlines: [{ description: 'Adjuster assignment expected', date: '3-5 business days' }],
        nextAction: 'Follow up in 3-5 business days for adjuster assignment',
        suggestedFollowUpDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        summary: 'Claim opened, adjuster pending assignment.',
        confidence: { claimNumber: 1.0 },
        evidence: {},
      });
  }

  private async scenarioVoicemail(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.emitStatus(missionId, 'dialing');
    await this.emitEvent(missionId, callSessionId, 'dialing');
    await sleep(1500);

    await this.emitStatus(missionId, 'ringing');
    await this.emitEvent(missionId, callSessionId, 'ringing');
    await sleep(3000);

    await this.emitEvent(missionId, callSessionId, 'answered', {
      machineDetection: 'voicemail',
    });

    let seq = 1;
    await this.emitTranscript(missionId, callSessionId, 'automated_phone_system',
      "You've reached the claims department. Please leave a message after the tone.", seq++);
    await sleep(1000);

    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Hello, this is a message from Ramos James Law. We are calling to open a new insurance claim. Please return our call at your earliest convenience at 512-555-0100. Thank you.", seq++);

    await this.completeCall(missionId, callSessionId, 'failure',
      'Reached voicemail. Left callback message.', {
        missionOutcome: 'failure',
        claimOpened: false,
        existingClaimLocated: false,
        claimNumber: null,
        representativeName: null,
        adjusterName: null,
        adjusterPhone: null,
        adjusterEmail: null,
        requestedDocuments: [],
        missingInformation: [],
        commitments: [],
        deadlines: [],
        nextAction: 'Retry call during business hours',
        summary: 'Voicemail reached, message left.',
        confidence: {},
        evidence: {},
      });
  }

  private async scenarioAiRefused(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.runDialSequence(missionId, callSessionId);

    let seq = 1;
    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Hello, I'm an AI-assisted calling agent contacting you on behalf of Ramos James Law.", seq++);
    await sleep(2000);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "I'm sorry, but I cannot process a claim with an AI agent. I need to speak with a human representative. Please have an attorney call us back.", seq++);

    await this.completeCall(missionId, callSessionId, 'human_follow_up',
      'Representative refused AI interaction. Human follow-up required.', {
        missionOutcome: 'human_follow_up',
        claimOpened: false,
        existingClaimLocated: false,
        claimNumber: null,
        representativeName: null,
        adjusterName: null,
        adjusterPhone: null,
        adjusterEmail: null,
        requestedDocuments: [],
        missingInformation: [],
        commitments: [],
        deadlines: [],
        escalationReason: 'Representative refused to speak with AI agent',
        summary: 'Representative refused AI interaction.',
        confidence: {},
        evidence: {},
      });
  }

  private async scenarioRecordedStatement(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.runDialSequence(missionId, callSessionId);

    let seq = 1;
    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Hello, I'm calling on behalf of Ramos James Law to open a claim.", seq++);
    await sleep(2000);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "Before we proceed, I'll need a recorded statement from the claimant.", seq++);
    await sleep(1000);

    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "I'm not able to provide a recorded statement. That would require coordination with the attorney. I'll note this request and have someone follow up.", seq++);

    await this.completeCall(missionId, callSessionId, 'human_follow_up',
      'Recorded statement requested — escalated to human follow-up.', {
        missionOutcome: 'human_follow_up',
        claimOpened: false,
        existingClaimLocated: false,
        claimNumber: null,
        representativeName: null,
        adjusterName: null,
        adjusterPhone: null,
        adjusterEmail: null,
        requestedDocuments: [],
        missingInformation: [],
        commitments: [],
        deadlines: [],
        escalationReason: 'Representative requested recorded statement from claimant',
        summary: 'Escalated: recorded statement required.',
        confidence: {},
        evidence: {},
      });
  }

  private async scenarioDisconnected(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.runDialSequence(missionId, callSessionId);

    let seq = 1;
    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Hello, I'm calling on behalf of Ramos James Law—", seq++);
    await sleep(1500);

    await this.emitEvent(missionId, callSessionId, 'websocket_disconnected', {
      reason: 'Call dropped unexpectedly',
    });

    await this.failCall(missionId, callSessionId, 'Call disconnected unexpectedly');
  }

  private async scenarioInvalidPhone(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.emitStatus(missionId, 'dialing');
    await this.emitEvent(missionId, callSessionId, 'dialing');
    await sleep(1500);

    await this.failCall(
      missionId,
      callSessionId,
      'Invalid phone number: the number you have dialed is not in service'
    );
  }

  private async scenarioXaiFailure(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.emitStatus(missionId, 'dialing');
    await this.emitEvent(missionId, callSessionId, 'dialing');
    await sleep(1000);
    await this.emitStatus(missionId, 'ringing');
    await this.emitEvent(missionId, callSessionId, 'ringing');
    await sleep(2000);
    await this.emitStatus(missionId, 'answered');
    await this.emitEvent(missionId, callSessionId, 'answered');
    await sleep(500);

    await this.emitEvent(missionId, callSessionId, 'call_failed', {
      reason: 'xAI WebSocket connection failed',
      errorCategory: 'xai_websocket',
    });

    await this.failCall(
      missionId,
      callSessionId,
      'xAI WebSocket connection failed — could not establish AI voice session'
    );
  }

  private async scenarioTwilioFailure(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await sleep(500);

    await this.failCall(
      missionId,
      callSessionId,
      'Twilio call initiation failed: invalid credentials or account issue'
    );
  }

  private async scenarioHoldTimeout(
    missionId: string,
    callSessionId: string
  ): Promise<void> {
    await this.runDialSequence(missionId, callSessionId);

    let seq = 1;
    await this.emitTranscript(missionId, callSessionId, 'ai_agent',
      "Hello, I'm calling on behalf of Ramos James Law.", seq++);
    await sleep(1500);

    await this.emitTranscript(missionId, callSessionId, 'insurance_representative',
      "Please hold while I transfer you to the claims department.", seq++);
    await sleep(1000);

    await this.emitStatus(missionId, 'on_hold');
    await this.emitEvent(missionId, callSessionId, 'call_on_hold');
    await sleep(3000);

    await this.emitEvent(missionId, callSessionId, 'call_failed', {
      reason: 'Maximum hold duration exceeded',
    });

    await this.failCall(
      missionId,
      callSessionId,
      'Call failed: maximum hold duration exceeded while waiting for transfer'
    );
  }
}
