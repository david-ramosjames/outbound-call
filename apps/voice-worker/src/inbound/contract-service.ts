import {
  contractTemplateIdFor,
  type AgreementStatus,
  type ContractDeliveryRequest,
  type ContractSendResult,
  type InboundConfig,
  type InboundContractService,
  type InboundIntakeState,
} from '@outbound-call/shared';
import { config as env } from '../config.js';
import { logger } from '../utils/logger.js';
import { sendSms } from './telephony.js';

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
}

function toE164(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.trim().startsWith('+') ? `+${digits}` : null;
}

async function signflowFetch(path: string, init: RequestInit = {}): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  const base = env.SIGNFLOW_BASE_URL.trim().replace(/\/$/, '');
  if (!base || !env.SIGNFLOW_INTAKE_TOKEN) return { ok: false, error: 'Sign Flow is not configured (SIGNFLOW_BASE_URL / SIGNFLOW_INTAKE_TOKEN)' };
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${env.SIGNFLOW_INTAKE_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof body.error === 'string' ? body.error : `Sign Flow responded ${res.status}` };
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Sign Flow request failed' };
  }
}

function signflowStatus(body: Record<string, unknown>): AgreementStatus {
  if (body.signed === true) return 'signed';
  switch (body.status) {
    case 'viewed':
      return 'viewed';
    case 'sent':
    case 'draft':
      return body.viewed === true ? 'viewed' : 'sent';
    case 'failed':
      return 'declined';
    case 'expired':
      return 'expired';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

/**
 * Engagement agreement delivery. Providers:
 *  - none:     never sends.
 *  - signflow: creates a DocuSeal signing request in Sign Flow, which texts or emails the link
 *              and reports opened/signed (status endpoint + callback to /webhooks/inbound/contracts/signflow).
 *  - sms_link: texts a link to an existing e-sign form (link may include {{intake_id}}).
 *  - webhook:  POSTs the intake to an e-sign integration, which returns { external_id, signing_url };
 *              the signing URL is texted. Signature status comes back on /webhooks/inbound/contracts/:provider.
 */
export function createContractService(config: InboundConfig, smsFrom: string): InboundContractService {
  const c = config.contracts;

  if (c.provider === 'signflow') {
    return {
      async sendAgreement(state: InboundIntakeState, req: ContractDeliveryRequest): Promise<ContractSendResult> {
        const templateId = contractTemplateIdFor(config, state.language);
        if (!templateId) return { ok: false, provider: c.provider, error: 'No Sign Flow template configured' };
        const phone = toE164(req.phone);
        if (req.delivery === 'sms' && !phone) return { ok: false, provider: c.provider, error: 'No valid mobile number' };
        const res = await signflowFetch('/api/intake', {
          method: 'POST',
          body: JSON.stringify({
            clientName: state.facts.caller_name ?? '',
            phone,
            email: req.email ?? undefined,
            language: state.language,
            templateId,
            source: 'inbound-ai',
            dateOfLoss: state.facts.incident_date ?? null,
            sendSms: req.delivery === 'sms',
            sendEmail: req.delivery === 'email',
            reminderEnabled: true,
            externalRef: state.intakeId,
          }),
        });
        if (!res.ok) {
          logger.error('Sign Flow send failed', { intakeId: state.intakeId, errorMessage: res.error });
          return { ok: false, provider: c.provider, error: res.error };
        }
        const delivered = req.delivery === 'sms' ? res.body.sentViaSms === true : res.body.sentViaEmail === true;
        const externalId = typeof res.body.signingRequestId === 'string' ? res.body.signingRequestId : null;
        if (!delivered) {
          const warning = typeof res.body.warning === 'string' ? res.body.warning : 'not delivered';
          logger.error('Sign Flow created the request but did not deliver it', { intakeId: state.intakeId, externalId, errorMessage: warning });
          return { ok: false, provider: c.provider, externalId, error: `Created but not delivered: ${warning}` };
        }
        return { ok: true, provider: c.provider, externalId };
      },

      async getStatus(state) {
        if (!state.contract.externalId) return { ok: false, error: 'No signing request id' };
        const res = await signflowFetch(`/api/intake/${encodeURIComponent(state.contract.externalId)}`);
        return res.ok ? { ok: true, status: signflowStatus(res.body) } : { ok: false, error: res.error };
      },

      async resend(state, req) {
        if (!state.contract.externalId) return { ok: false, error: 'No signing request id' };
        const phone = toE164(req.phone);
        const res = await signflowFetch(`/api/intake/${encodeURIComponent(state.contract.externalId)}/resend`, {
          method: 'POST',
          body: JSON.stringify({
            sms: req.delivery === 'sms',
            email: req.delivery === 'email',
            ...(req.delivery === 'email' && req.email ? { emailAddress: req.email } : {}),
            ...(req.delivery === 'sms' && phone ? { phone } : {}),
          }),
        });
        return res.ok ? { ok: true } : { ok: false, error: res.error };
      },
    };
  }

  return {
    async sendAgreement(state: InboundIntakeState, req: ContractDeliveryRequest): Promise<ContractSendResult> {
      const vars = { intake_id: state.intakeId, caller_name: state.facts.caller_name ?? '' };
      const toPhone = req.phone;

      if (c.provider === 'none') return { ok: false, provider: 'none', error: 'No provider configured' };
      if (!toPhone) return { ok: false, provider: c.provider, error: 'No phone number' };

      let link: string;
      let externalId: string | null = null;

      if (c.provider === 'sms_link') {
        if (!c.sms_link_url) return { ok: false, provider: c.provider, error: 'sms_link_url not configured' };
        link = fill(c.sms_link_url, { ...vars, intake_id: encodeURIComponent(state.intakeId) });
        externalId = state.intakeId;
      } else {
        if (!c.webhook_url) return { ok: false, provider: c.provider, error: 'webhook_url not configured' };
        try {
          const res = await fetch(c.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              intake_id: state.intakeId,
              caller_name: state.facts.caller_name,
              phone: toPhone,
              email: state.facts.email ?? null,
              language: state.language,
              case_type: state.facts.case_type ?? null,
              incident_date: state.facts.incident_date ?? null,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return { ok: false, provider: c.provider, error: `Provider responded ${res.status}` };
          const body = (await res.json()) as { external_id?: string; signing_url?: string };
          if (!body.signing_url) return { ok: false, provider: c.provider, error: 'Provider returned no signing_url' };
          link = body.signing_url;
          externalId = body.external_id ?? null;
        } catch (err) {
          logger.error('Contract provider request failed', { intakeId: state.intakeId, error: err });
          return { ok: false, provider: c.provider, error: err instanceof Error ? err.message : 'Provider request failed' };
        }
      }

      const sms = await sendSms(smsFrom, toPhone, fill(c.sms_message_template, { ...vars, link }));
      if (!sms.ok) return { ok: false, provider: c.provider, error: sms.error };
      return { ok: true, provider: c.provider, externalId };
    },
  };
}
