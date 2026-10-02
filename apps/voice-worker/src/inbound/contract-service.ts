import type { ContractSendResult, InboundConfig, InboundContractService, InboundIntakeState } from '@outbound-call/shared';
import { logger } from '../utils/logger.js';
import { sendSms } from './telephony.js';

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
}

/**
 * Engagement agreement delivery. Providers:
 *  - none:     never sends.
 *  - sms_link: texts a link to an existing e-sign form (link may include {{intake_id}}).
 *  - webhook:  POSTs the intake to an e-sign integration, which returns { external_id, signing_url };
 *              the signing URL is texted. Signature status comes back on /webhooks/inbound/contracts/:provider.
 */
export function createContractService(config: InboundConfig, smsFrom: string): InboundContractService {
  return {
    async sendAgreement(state: InboundIntakeState, toPhone: string): Promise<ContractSendResult> {
      const c = config.contracts;
      const vars = { intake_id: state.intakeId, caller_name: state.facts.caller_name ?? '' };

      if (c.provider === 'none') return { ok: false, provider: 'none', error: 'No provider configured' };

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
