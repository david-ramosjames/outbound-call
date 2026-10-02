import type { AgentInstructions, InboundConfig, InboundIntakeState, InboundRuntime } from '@outbound-call/shared';
import { createContractService } from './contract-service.js';
import { insertCallbackRequests, saveIntakeState, updateInboundCall, writeAudit, type InboundCallRow } from './store.js';
import { redirectToHuman, sendSms, transferDialTwiml } from './telephony.js';

/** Runtime for a live phone call: database, Twilio, and the configured contract provider. */
export function createLiveRuntime(input: {
  config: InboundConfig;
  instructions: AgentInstructions;
  call: InboundCallRow;
  state: InboundIntakeState;
}): InboundRuntime {
  const { config, instructions, call, state } = input;
  const smsFrom = config.routing.sms_from_number.trim() || call.to_number || '';
  let callbacksSaved = state.callbacks.length;

  return {
    config,
    instructions,
    now: () => new Date(),
    businessOverride: null,
    audit: (event) => writeAudit({ callId: call.id, intakeId: state.intakeId }, event),
    telephony: {
      async startTransfer(target) {
        if (!call.twilio_call_sid) return { ok: false, error: 'No Twilio call to transfer' };
        const body = transferDialTwiml({
          inboundCallId: call.id,
          target,
          timeoutSeconds: config.routing.transfer_timeout_seconds,
          callerId: call.from_number,
        });
        const res = await redirectToHuman(call.twilio_call_sid, body);
        if (res.ok) await updateInboundCall(call.id, { status: 'transferring', transfer_status: 'ringing', transferred_to: target.label });
        return res;
      },
      sendSms: (to, body) => sendSms(smsFrom, to, body),
    },
    contracts: createContractService(config, smsFrom),
    async persist(s) {
      await saveIntakeState(s);
      callbacksSaved = await insertCallbackRequests(s, callbacksSaved);
    },
  };
}
