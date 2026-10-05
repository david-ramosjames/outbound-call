import { describe, expect, it } from 'vitest';
import {
  availableActionsFor,
  buildInboundGreeting,
  buildInboundInstructions,
  businessStatusFor,
  checkAgentUtterance,
  createMemoryRuntime,
  evaluateQualification,
  executeInboundTool,
  formatIntakeSummary,
  getMissingFields,
  inboundConfigSchema,
  newIntakeState,
  normalizeE164,
  resolveAgentInstructions,
  resolveInboundConfig,
  type InboundConfig,
  type InboundIntakeState,
  type SimulationOptions,
} from '../index.js';

// Wed Sep 30 2026, 10:00 AM in Chicago (office open)
const BUSINESS_NOW = new Date('2026-09-30T15:00:00Z');
// Wed Sep 30 2026, 10:00 PM in Chicago (after hours)
const AFTER_HOURS_NOW = new Date('2026-10-01T03:00:00Z');

function liveConfig(overrides: Partial<{ flags: Record<string, boolean>; routing: Record<string, unknown> }> = {}): InboundConfig {
  return inboundConfigSchema.parse({
    flags: {
      inbound_enabled: true,
      inbound_voice_enabled: true,
      human_transfer_enabled: true,
      contracts_enabled: true,
      sms_enabled: true,
      ...overrides.flags,
    },
    routing: {
      primary_transfer_number: '+15125550100',
      backup_transfer_number: '+15125550101',
      existing_client_transfer_number: '+15125550102',
      ...overrides.routing,
    },
    contracts: { provider: 'sms_link', sms_link_url: 'https://sign.example.com/{{intake_id}}', allowed_results: ['qualified', 'high_priority'] },
  });
}

function setup(opts: SimulationOptions = {}) {
  const { runtime, log } = createMemoryRuntime({ config: liveConfig(), now: BUSINESS_NOW, ...opts });
  const state = newIntakeState({ intakeId: 'intake-1', callId: 'call-1', callerIdNumber: '(512) 555-1234' });
  const tool = (name: string, args: unknown = {}) => executeInboundTool(name, args, state, runtime);
  return { runtime, log, state, tool };
}

const STRONG_AUTO = {
  caller_type: 'new_potential_client',
  case_type: 'motor_vehicle',
  incident_date: '2026-09-25',
  incident_city: 'Austin',
  incident_state: 'Texas',
  incident_location: 'I-35 northbound',
  incident_description: 'Rear-ended while stopped at a red light',
  injury_description: 'Neck and back pain',
  injury_severity: 'moderate',
  medical_treatment: true,
  medical_treatment_description: "St. David's ER same day",
  fault_summary: 'Caller was stopped at a light and was struck from behind',
  caller_at_fault: 'no',
  represented_by_attorney: false,
  police_report: true,
  insurance_information: 'Other driver has State Farm',
  property_damage: 'Rear bumper and trunk',
};

async function strongAuto(t: ReturnType<typeof setup>['tool']) {
  await t('save_contact_information', { caller_name: 'Jane Doe', use_caller_id_number: true });
  await t('update_intake', { facts: STRONG_AUTO });
}

function auditTypes(log: ReturnType<typeof setup>['log']) {
  return log.audit.map((a) => a.type);
}

describe('inbound intake: defaults', () => {
  it('risky capabilities are off by default', () => {
    const cfg = resolveInboundConfig(null);
    expect(cfg.flags.inbound_enabled).toBe(false);
    expect(cfg.flags.inbound_voice_enabled).toBe(false);
    expect(cfg.flags.human_transfer_enabled).toBe(false);
    expect(cfg.flags.contracts_enabled).toBe(false);
    expect(cfg.flags.sms_enabled).toBe(false);
    expect(cfg.contracts.provider).toBe('none');
  });

  it('rejects unknown tools and invalid arguments', async () => {
    const { tool, log } = setup();
    expect((await tool('delete_everything', {})).ok).toBe(false);
    expect((await tool('send_engagement_agreement', { caller_consented: false })).ok).toBe(false);
    expect(auditTypes(log).filter((t) => t === 'TOOL_REJECTED')).toHaveLength(2);
  });

  it('never sends an agreement with default config even if facts qualify', async () => {
    const { runtime } = createMemoryRuntime({ now: BUSINESS_NOW });
    const state = newIntakeState({ intakeId: 'i', callId: 'c', callerIdNumber: '5125551234' });
    await executeInboundTool('save_contact_information', { caller_name: 'Jane Doe', use_caller_id_number: true }, state, runtime);
    await executeInboundTool('update_intake', { facts: STRONG_AUTO }, state, runtime);
    const res = await executeInboundTool('send_engagement_agreement', { caller_consented: true }, state, runtime);
    expect(res.ok).toBe(false);
    expect(state.contract.sent).toBe(false);
  });
});

describe('inbound intake: 20 seed scenarios', () => {
  it('1. strong auto accident qualifies and is eligible for transfer and agreement', async () => {
    const s = setup();
    await strongAuto(s.tool);
    expect(s.state.facts.incident_state).toBe('TX');
    expect(s.state.qualification?.result).toBe('qualified');
    expect(s.state.qualification?.canSendContract).toBe(true);
    expect(getMissingFields(s.state.facts, BUSINESS_NOW).missing).toHaveLength(0);
    const actions = availableActionsFor(s.state, s.runtime);
    expect(actions.canTransfer).toBe(true);
    expect(actions.canOfferContract).toBe(true);
    expect(actions.recommendedNextAction).toBe('offer_transfer');
  });

  it('2. weak auto accident (minor injury, no treatment) needs review and blocks the agreement', async () => {
    const s = setup();
    await strongAuto(s.tool);
    await s.tool('update_intake', { facts: { injury_severity: 'minor', medical_treatment: false, injury_description: 'A little sore' } });
    expect(s.state.qualification?.result).toBe('needs_review');
    expect(s.state.qualification?.canSendContract).toBe(false);
    expect((await s.tool('send_engagement_agreement', { caller_consented: true })).ok).toBe(false);
    expect(s.state.contract.sent).toBe(false);
  });

  it('3. commercial trucking with hospitalization escalates before the full intake', async () => {
    const s = setup();
    await s.tool('update_intake', {
      facts: { caller_type: 'new_potential_client', case_type: 'trucking', commercial_vehicle_involved: true, hospitalized: true, injury_description: 'In the hospital' },
    });
    expect(s.state.highPriority).toBe(true);
    expect(auditTypes(s.log)).toContain('HIGH_PRIORITY_DETECTED');
    expect(getMissingFields(s.state.facts, BUSINESS_NOW).mode).toBe('urgent_minimum');
    expect(availableActionsFor(s.state, s.runtime).recommendedNextAction).toBe('collect_minimum_contact');

    await s.tool('save_contact_information', { caller_name: 'Mike Ruiz', phone: '512 555 9876' });
    await s.tool('update_intake', { facts: { incident_description: 'Hit by an 18-wheeler on I-10 yesterday' } });
    expect(s.state.qualification?.result).toBe('high_priority');
    const actions = availableActionsFor(s.state, s.runtime);
    expect(actions.urgent).toBe(true);
    expect(actions.recommendedNextAction).toBe('offer_transfer');
  });

  it('4. wrongful death is high priority and never gets an automated agreement', async () => {
    const s = setup();
    await s.tool('save_contact_information', { caller_name: 'Rosa Diaz', use_caller_id_number: true });
    await s.tool('update_intake', {
      facts: { caller_type: 'new_potential_client', case_type: 'wrongful_death', fatality: true, incident_state: 'TX', incident_description: 'Her husband was killed in a crash' },
    });
    expect(s.state.qualification?.result).toBe('high_priority');
    expect(s.state.qualification?.canSendContract).toBe(false);
    expect(s.state.qualification?.contractBlockedBy.length).toBeGreaterThan(0);
    expect(availableActionsFor(s.state, s.runtime).canOfferContract).toBe(false);
  });

  it('5. caller already represented needs review and blocks the agreement', async () => {
    const s = setup();
    await strongAuto(s.tool);
    await s.tool('update_intake', { facts: { represented_by_attorney: true, previous_attorney: 'Smith Law' } });
    expect(s.state.qualification?.result).toBe('needs_review');
    expect(s.state.qualification?.reasons.join(' ')).toMatch(/attorney/i);
    expect(availableActionsFor(s.state, s.runtime).canOfferContract).toBe(false);
  });

  it('6. incident outside accepted jurisdiction is not qualified and declined politely', async () => {
    const s = setup();
    await strongAuto(s.tool);
    await s.tool('update_intake', { facts: { incident_state: 'Oklahoma', incident_city: 'Tulsa' } });
    expect(s.state.facts.incident_state).toBe('OK');
    await s.tool('evaluate_qualification');
    expect(s.state.qualification?.result).toBe('not_qualified');
    const actions = availableActionsFor(s.state, s.runtime);
    expect(actions.recommendedNextAction).toBe('decline_politely');
    expect(actions.canTransfer).toBe(false);
    expect(actions.canOfferContract).toBe(false);
  });

  it('7. old incidents: 18-24 months needs review, over 2 years not qualified', async () => {
    const s = setup();
    await strongAuto(s.tool);
    await s.tool('update_intake', { facts: { incident_date: '2025-03-01' } }); // ~578 days
    expect(s.state.qualification?.result).toBe('needs_review');
    expect(s.state.qualification?.canSendContract).toBe(false);
    await s.tool('update_intake', { facts: { incident_date: '2024-06-01' } }); // ~851 days
    expect(s.state.qualification?.result).toBe('not_qualified');
    expect(auditTypes(s.log)).toContain('QUALIFICATION_CHANGED');
  });

  it('8. injury without medical treatment needs review', async () => {
    const s = setup();
    await strongAuto(s.tool);
    await s.tool('update_intake', { facts: { medical_treatment: false } });
    expect(s.state.qualification?.result).toBe('needs_review');
    expect(s.state.qualification?.reasons.join(' ')).toMatch(/treatment/i);
  });

  it('9. existing client: no qualification, routed to the existing-client line', async () => {
    const s = setup();
    await s.tool('update_intake', { facts: { caller_type: 'existing_client' } });
    await s.tool('save_contact_information', { caller_name: 'Carlos Vega', use_caller_id_number: true });
    await s.tool('update_intake', { facts: { existing_client_case_reference: '2024-118', existing_client_reason: 'Question about a medical bill' } });
    expect(s.state.qualification).toBeNull();
    const actions = availableActionsFor(s.state, s.runtime);
    expect(actions.recommendedNextAction).toBe('offer_transfer');
    expect(actions.nextTransferTarget?.label).toBe('existing_client');
    const res = await s.tool('transfer_to_human', { reason: 'Existing client billing question' });
    expect(res.ok).toBe(true);
    expect(s.log.transfers[0]?.number).toBe('+15125550102');
    expect(s.state.status).toBe('transferred');
  });

  it('10. Spanish-speaking caller: language recorded, Spanish greeting, facts normalized', async () => {
    const s = setup();
    await s.tool('set_language', { language: 'es' });
    expect(s.state.language).toBe('es');
    expect(s.state.facts.preferred_language).toBe('es');
    expect(buildInboundGreeting({ instructions: s.runtime.instructions, state: s.state })).toMatch(/Gracias por llamar/);
    await s.tool('update_intake', { facts: { incident_state: 'Tejas' } });
    expect(s.state.facts.incident_state).toBe('TX');
    const prompt = buildInboundInstructions({ instructions: s.runtime.instructions, config: s.runtime.config, state: s.state, business: businessStatusFor(s.runtime), now: BUSINESS_NOW });
    expect(prompt).toMatch(/current language is Spanish/);
  });

  it('11. caller switches English -> Spanish -> English; Spanish can be disabled', async () => {
    const s = setup();
    await s.tool('set_language', { language: 'es' });
    await s.tool('set_language', { language: 'en' });
    expect(auditTypes(s.log).filter((t) => t === 'LANGUAGE_CHANGED')).toHaveLength(2);
    expect(s.state.language).toBe('en');

    const off = setup({ config: liveConfig({ flags: { spanish_enabled: false } }) });
    expect((await off.tool('set_language', { language: 'es' })).ok).toBe(false);
    expect(off.state.language).toBe('en');
  });

  it('12. caller refuses some information: not asked again, noted for staff', async () => {
    const s = setup();
    await strongAuto(s.tool);
    await s.tool('update_intake', { facts: { police_report: null } });
    await s.tool('record_declined_field', { key: 'police_report' });
    const missing = getMissingFields(s.state.facts, BUSINESS_NOW);
    expect(missing.missing.map((m) => m.key)).not.toContain('police_report');
    expect(formatIntakeSummary(s.state)).toMatch(/Declined to provide: police_report/);
  });

  it('13. emotional caller: intake is preserved and can be flagged for review', async () => {
    const s = setup();
    await s.tool('save_contact_information', { caller_name: 'Ana Lopez', use_caller_id_number: true });
    await s.tool('update_intake', { facts: { caller_type: 'new_potential_client', incident_description: 'My son was hurt, I cannot stop crying' } });
    await s.tool('mark_needs_review', { reason: 'Caller very distressed; facts incomplete' });
    expect(s.state.status).toBe('needs_review');
    expect(s.state.facts.caller_name).toBe('Ana Lopez');
    const prompt = buildInboundInstructions({ instructions: s.runtime.instructions, config: s.runtime.config, state: s.state, business: businessStatusFor(s.runtime), now: BUSINESS_NOW });
    expect(prompt).toMatch(/Never rush a grieving caller/);
    expect(prompt).toMatch(/Already known \(do NOT ask again\)/);
  });

  it('14. "How much is my case worth?": valuations are flagged, the approved deflection is not', () => {
    expect(checkAgentUtterance('Your case is worth at least $50,000.').map((v) => v.category)).toContain('case_value');
    expect(checkAgentUtterance("You'll definitely get a settlement.").map((v) => v.category)).toContain('outcome_guarantee');
    expect(
      checkAgentUtterance("I'm not able to give a value on a case, but I'll make sure our team has all the details."),
    ).toHaveLength(0);
  });

  it('15. legal advice requests: advice is flagged, deflection is not', () => {
    expect(checkAgentUtterance("Don't talk to the insurance adjuster.").map((v) => v.category)).toContain('legal_advice');
    expect(checkAgentUtterance('No hable con el seguro.').map((v) => v.category)).toContain('legal_advice');
    expect(checkAgentUtterance('We will take your case.').map((v) => v.category)).toContain('case_acceptance');
    expect(checkAgentUtterance("You're now our client.").map((v) => v.category)).toContain('representation');
    expect(checkAgentUtterance("That's a great question for our attorneys. I'm not able to give legal advice.")).toHaveLength(0);
  });

  it('16. qualified during business hours: transfer to the primary line succeeds', async () => {
    const s = setup();
    await strongAuto(s.tool);
    const res = await s.tool('transfer_to_human', { reason: 'Qualified MVA lead' });
    expect(res.ok).toBe(true);
    expect(res.transferStarted).toBe(true);
    expect(s.log.transfers[0]).toEqual({ number: '+15125550100', label: 'primary' });
    expect(s.state.status).toBe('transferred');
    expect(auditTypes(s.log)).toEqual(expect.arrayContaining(['TRANSFER_ATTEMPTED', 'TRANSFER_SUCCEEDED']));
    expect(formatIntakeSummary(s.state)).toMatch(/Transfer to primary: connected/);
  });

  it('17. qualified after hours: no transfer, agreement offered and sent, follow-up next business day', async () => {
    const s = setup({ now: AFTER_HOURS_NOW });
    await strongAuto(s.tool);
    const business = businessStatusFor(s.runtime);
    expect(business.status).toBe('after_hours');
    expect(business.nextOpenPhrase).toBe('tomorrow at 8:00 AM');

    const actions = availableActionsFor(s.state, s.runtime);
    expect(actions.canTransfer).toBe(false);
    expect(actions.recommendedNextAction).toBe('offer_contract');
    expect((await s.tool('transfer_to_human', { reason: 'x' })).ok).toBe(false);

    const sent = await s.tool('send_engagement_agreement', { caller_consented: true });
    expect(sent.ok).toBe(true);
    expect(s.state.contract.sent).toBe(true);
    expect(s.state.status).toBe('contract_sent');
    expect(s.log.contracts[0]?.to).toBe('(512) 555-1234');

    const cb = await s.tool('request_callback', { reason: 'Follow up on agreement' });
    expect(String(cb.output.tell_caller)).toMatch(/tomorrow at 8:00 AM/);
  });

  it('18. human transfer fails: tries backup, returns to AI, urgent callback', async () => {
    const s = setup({ transferOutcomes: ['no_answer', 'no_answer'] });
    await strongAuto(s.tool);

    const first = await s.tool('transfer_to_human', { reason: 'Qualified lead' });
    expect(first.ok).toBe(false);
    expect(String(first.output.say)).toBe(s.runtime.instructions.transfer_failed_language);
    expect(availableActionsFor(s.state, s.runtime).nextTransferTarget?.label).toBe('backup');

    await s.tool('transfer_to_human', { reason: 'Qualified lead, primary no answer' });
    const actions = availableActionsFor(s.state, s.runtime);
    expect(actions.canTransfer).toBe(false);
    expect(actions.callbackPriority).toBe('urgent');
    expect(actions.shouldRequestCallback).toBe(true);
    expect(auditTypes(s.log).filter((t) => t === 'TRANSFER_FAILED')).toHaveLength(2);

    await s.tool('request_callback', { reason: 'Transfer failed' });
    expect(s.state.callbacks[0]?.priority).toBe('urgent');
  });

  it('19. agreement send fails: logged, flagged for review, caller not dead-ended', async () => {
    const s = setup({ contractOutcome: 'fail' });
    await strongAuto(s.tool);
    const res = await s.tool('send_engagement_agreement', { caller_consented: true });
    expect(res.ok).toBe(false);
    expect(String(res.output.guidance)).toMatch(/request_callback/);
    expect(s.state.contract.sent).toBe(false);
    expect(s.state.contract.lastError).toBeTruthy();
    expect(s.state.needsReviewReasons).toContain('Engagement agreement failed to send');
    expect(auditTypes(s.log)).toContain('CONTRACT_SEND_FAILED');
    expect(formatIntakeSummary(s.state)).toMatch(/FAILED to send/);
  });

  it('20. ambiguous case requires human review', async () => {
    const s = setup();
    await s.tool('save_contact_information', { caller_name: 'Sam Lee', use_caller_id_number: true });
    await s.tool('update_intake', {
      facts: { caller_type: 'new_potential_client', case_type: 'unknown', incident_description: 'Something happened at work with a machine', injury_description: 'Hurt my hand' },
    });
    expect(s.state.qualification?.result).toBe('needs_review');
    // Nothing matched at all -> configured default
    const bare = evaluateQualification({ caller_type: 'new_potential_client' }, s.runtime.config.qualification, BUSINESS_NOW);
    expect(bare.result).toBe('needs_review');
    expect(bare.canSendContract).toBe(false);
  });
});

describe('inbound intake: Sign Flow agreement on the call', () => {
  function signflowSetup(opts: SimulationOptions = {}, contracts: Record<string, unknown> = {}) {
    const base = liveConfig();
    const config = inboundConfigSchema.parse({
      ...base,
      contracts: {
        ...base.contracts,
        provider: 'signflow',
        signflow_template_id_en: 101,
        knowledge_en: 'Contingency fee: 33 1/3% of any recovery before suit is filed.',
        approved_answers: 'If you do not recover anything, you owe no attorney fee.',
        ...contracts,
      },
    });
    return setup({ config, now: AFTER_HOURS_NOW, ...opts });
  }

  it('offers text or email, stays on the line, and confirms the signature only from the status check', async () => {
    const s = signflowSetup({ agreementStatus: 'viewed' });
    await strongAuto(s.tool);
    const actions = availableActionsFor(s.state, s.runtime);
    expect(actions.recommendedNextAction).toBe('offer_contract');
    expect(actions.contractDelivery).toEqual(['sms', 'email']);

    const noEmail = await s.tool('send_engagement_agreement', { caller_consented: true, delivery: 'email' });
    expect(noEmail.ok).toBe(false);
    expect(s.state.contract.sent).toBe(false);

    const sent = await s.tool('send_engagement_agreement', { caller_consented: true, delivery: 'email', email: 'jane@example.com' });
    expect(sent.ok).toBe(true);
    expect(s.log.contracts[0]).toEqual({ to: 'jane@example.com', delivery: 'email' });
    expect(availableActionsFor(s.state, s.runtime).recommendedNextAction).toBe('help_sign_agreement');

    const opened = await s.tool('check_agreement_status');
    expect(opened.output).toMatchObject({ opened: true, signed: false });
    expect(s.state.status).toBe('contract_sent');
    expect(auditTypes(s.log)).toContain('CONTRACT_VIEWED');
  });

  it('records a signature reported by the provider', async () => {
    const s = signflowSetup({ agreementStatus: 'signed' });
    await strongAuto(s.tool);
    await s.tool('send_engagement_agreement', { caller_consented: true, delivery: 'sms' });
    const res = await s.tool('check_agreement_status');
    expect(res.output).toMatchObject({ opened: true, signed: true });
    expect(s.state.status).toBe('contract_signed');
    expect(auditTypes(s.log)).toContain('CONTRACT_SIGNED');
    expect(availableActionsFor(s.state, s.runtime).recommendedNextAction).not.toBe('help_sign_agreement');
    expect(formatIntakeSummary(s.state)).toMatch(/sent by text and SIGNED/);
  });

  it('declined in the form flags the intake for review', async () => {
    const s = signflowSetup({ agreementStatus: 'declined' });
    await strongAuto(s.tool);
    await s.tool('send_engagement_agreement', { caller_consented: true });
    await s.tool('check_agreement_status');
    expect(s.state.contract.closedReason).toBe('declined');
    expect(s.state.needsReviewReasons).toContain('Engagement agreement was not signed');
  });

  it('resends by the other method', async () => {
    const s = signflowSetup({ agreementStatus: 'sent' });
    await strongAuto(s.tool);
    await s.tool('send_engagement_agreement', { caller_consented: true, delivery: 'sms' });
    const res = await s.tool('resend_engagement_agreement', { delivery: 'email', email: 'jane@example.com' });
    expect(res.ok).toBe(true);
    expect(s.log.contracts[1]).toEqual({ to: 'jane@example.com', delivery: 'email', resend: true });
    expect(s.state.contract.resends).toBe(1);
  });

  it('is blocked without a template, and only offers allowed delivery methods', async () => {
    const none = signflowSetup({}, { signflow_template_id_en: null });
    await strongAuto(none.tool);
    expect(availableActionsFor(none.state, none.runtime).contractBlockedReason).toBe('No agreement template configured');

    const smsOnly = signflowSetup({}, { delivery_methods: ['sms'] });
    await strongAuto(smsOnly.tool);
    expect((await smsOnly.tool('send_engagement_agreement', { caller_consented: true, delivery: 'email', email: 'a@b.com' })).ok).toBe(false);
  });

  it('puts the agreement text and approved answers in the prompt', async () => {
    const s = signflowSetup();
    await strongAuto(s.tool);
    const prompt = buildInboundInstructions({
      instructions: s.runtime.instructions,
      config: s.runtime.config,
      state: s.state,
      business: businessStatusFor(s.runtime),
      now: AFTER_HOURS_NOW,
    });
    expect(prompt).toContain('Contingency fee: 33 1/3%');
    expect(prompt).toContain('you owe no attorney fee');
    expect(prompt).toContain('check_agreement_status');
  });
});

describe('inbound intake: multiple intake lines', () => {
  it('each line speaks with its own firm name', async () => {
    const config = resolveInboundConfig({ name: 'Trucking Chicas', flags: { sms_enabled: true } });
    expect(config.firm_name).toBe('Trucking Chicas');
    const ins = resolveAgentInstructions({}, config.firm_name);
    expect(ins.greeting_en).toContain('Thank you for calling Trucking Chicas');
    expect(ins.greeting_es).toContain('Gracias por llamar a Trucking Chicas');
    expect(JSON.stringify(ins)).not.toContain('{{firm_name}}');

    const { runtime, log } = createMemoryRuntime({ config, now: BUSINESS_NOW });
    const state = newIntakeState({ intakeId: 'i', callId: 'c', callerIdNumber: '(512) 555-1234' });
    expect(buildInboundGreeting({ instructions: runtime.instructions, state })).toContain('Trucking Chicas');
    await executeInboundTool('send_sms', { template: 'office_contact_info' }, state, runtime);
    expect(log.sms[0]?.body.startsWith('Trucking Chicas:')).toBe(true);
  });

  it('normalizes intake numbers for routing', () => {
    expect(normalizeE164('(737) 232-3927')).toBe('+17372323927');
    expect(normalizeE164('+1 737 232 3927')).toBe('+17372323927');
    expect(normalizeE164('12345')).toBeNull();
  });
});

describe('inbound intake: qualification reasons are internal', () => {
  it('evaluate_qualification output does not expose the result or reasons', async () => {
    const s = setup();
    await strongAuto(s.tool);
    await s.tool('update_intake', { facts: { incident_state: 'OK' } });
    const res = await s.tool('evaluate_qualification');
    const text = JSON.stringify(res.output);
    expect(text).not.toMatch(/not_qualified|jurisdiction|"reasons"|matched/);
    expect(res.output.next_step).toBe('decline_politely');
  });

  it('summary follows the staff format', async () => {
    const s = setup();
    await strongAuto(s.tool);
    const summary = formatIntakeSummary(s.state as InboundIntakeState);
    expect(summary.split('\n')[0]).toBe('NEW LEAD - MOTOR VEHICLE ACCIDENT');
    for (const heading of ['Caller:', 'Phone:', 'Language:', 'Incident:', 'Injuries:', 'Liability:', 'Representation:', 'Qualification:', 'Reasons:', 'Actions:']) {
      expect(summary).toContain(heading);
    }
  });
});
