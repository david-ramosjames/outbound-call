import type { AgentInstructions, InboundConfig } from './config.js';
import { resolveAgentInstructions, resolveInboundConfig } from './config.js';
import type { AgreementStatus, AuditEventInput, InboundRuntime } from './executor.js';
import type { BusinessStatusValue } from './types.js';

export interface SimulationOptions {
  config?: InboundConfig;
  instructions?: AgentInstructions;
  now?: Date;
  businessOverride?: BusinessStatusValue | null;
  /** Outcome of each successive transfer attempt. Defaults to "connected". */
  transferOutcomes?: Array<'connected' | 'no_answer'>;
  contractOutcome?: 'success' | 'fail';
  /** What check_agreement_status reports after sending. Defaults to "signed". */
  agreementStatus?: AgreementStatus;
  smsOutcome?: 'success' | 'fail';
}

export interface SimulationLog {
  audit: Array<AuditEventInput & { at: string }>;
  sms: Array<{ to: string; body: string }>;
  transfers: Array<{ number: string; label: string }>;
  contracts: Array<{ to: string; delivery: string; resend?: boolean }>;
}

/** Runtime with no side effects: used by the Test Agent and automated scenarios. */
export function createMemoryRuntime(opts: SimulationOptions = {}): { runtime: InboundRuntime; log: SimulationLog } {
  const log: SimulationLog = { audit: [], sms: [], transfers: [], contracts: [] };
  const outcomes = [...(opts.transferOutcomes ?? [])];
  const now = () => opts.now ?? new Date();

  const config = opts.config ?? resolveInboundConfig({});
  const runtime: InboundRuntime = {
    config,
    instructions: opts.instructions ?? resolveAgentInstructions({}, config.firm_name),
    now,
    businessOverride: opts.businessOverride ?? null,
    async audit(event) {
      log.audit.push({ ...event, at: now().toISOString() });
    },
    telephony: {
      async startTransfer(target) {
        log.transfers.push({ number: target.number, label: target.label });
        const outcome = outcomes.shift() ?? 'connected';
        return outcome === 'connected' ? { ok: true, connected: true } : { ok: true, connected: false, failureReason: 'no_answer' };
      },
      async sendSms(to, body) {
        if (opts.smsOutcome === 'fail') return { ok: false, error: 'simulated SMS failure' };
        log.sms.push({ to, body });
        return { ok: true, id: `sim-sms-${log.sms.length}` };
      },
    },
    contracts: {
      async sendAgreement(_state, req) {
        const provider = (opts.config ?? runtime.config).contracts.provider;
        if (opts.contractOutcome === 'fail') return { ok: false, provider, error: 'simulated provider failure' };
        log.contracts.push({ to: (req.delivery === 'email' ? req.email : req.phone) ?? '', delivery: req.delivery });
        return { ok: true, provider, externalId: `sim-contract-${log.contracts.length}` };
      },
      async getStatus() {
        return { ok: true, status: opts.agreementStatus ?? 'signed' };
      },
      async resend(_state, req) {
        log.contracts.push({ to: (req.delivery === 'email' ? req.email : req.phone) ?? '', delivery: req.delivery, resend: true });
        return { ok: true };
      },
    },
    async persist() {},
  };
  return { runtime, log };
}
