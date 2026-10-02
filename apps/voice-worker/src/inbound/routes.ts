import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import {
  computeAvailableActions,
  deriveIntakeStatus,
  getBusinessStatus,
  INBOUND_CASE_TYPE_LABELS,
} from '@outbound-call/shared';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { finalizeInboundCall } from './finalize.js';
import { runSimulationTurn, simulateRequestSchema } from './simulate.js';
import {
  createInboundCallWithIntake,
  getInboundCall,
  getInboundCallBySid,
  loadInboundSettings,
  loadIntakeById,
  loadIntakeForCall,
  saveIntakeState,
  updateInboundCall,
  writeAudit,
} from './store.js';
import { escapeXml, fallbackTwiml, sipBridgeTwiml, transferDialTwiml, twiml, validateTwilioRequest } from './telephony.js';

export const inboundRouter: RouterType = Router();

function sendTwiml(res: Response, body: string): void {
  res.status(200).set('Content-Type', 'text/xml').send(body);
}

function rejectUnsigned(req: Request, res: Response): boolean {
  if (validateTwilioRequest(req)) return false;
  logger.warn('Inbound Twilio signature verification failed', { path: req.path });
  res.status(403).send('Invalid signature');
  return true;
}

// ---------- Incoming call (Quo forwards to the AI intake number, whose Voice URL points here) ----------

inboundRouter.post('/webhooks/inbound/twilio/voice', async (req: Request, res: Response): Promise<void> => {
  if (rejectUnsigned(req, res)) return;
  const body = req.body as Record<string, string>;
  const { config: inbound } = await loadInboundSettings(true);

  try {
    const business = getBusinessStatus(inbound.business_hours);
    const aiAllowed =
      inbound.flags.inbound_enabled &&
      inbound.flags.inbound_voice_enabled &&
      (business.status === 'business_hours' || inbound.flags.after_hours_ai_enabled);

    if (!aiAllowed) {
      logger.info('Inbound AI disabled; using fallback routing', { twilioCallSid: body.CallSid });
      sendTwiml(res, fallbackTwiml(inbound.routing));
      return;
    }

    const created = await createInboundCallWithIntake({
      twilioCallSid: body.CallSid ?? null,
      from: body.From ?? null,
      to: body.To ?? null,
      forwardedFrom: body.ForwardedFrom ?? null,
      businessStatus: business.status,
    });
    if (!created) {
      sendTwiml(res, fallbackTwiml(inbound.routing));
      return;
    }

    await writeAudit(
      { callId: created.callId, intakeId: created.intakeId },
      { type: 'CALL_STARTED', actor: 'SYSTEM', data: { business_status: business.status, forwarded_from: body.ForwardedFrom ?? null } },
    );
    sendTwiml(res, sipBridgeTwiml(created.callId));
  } catch (err) {
    logger.error('Inbound voice webhook failed', { error: err, twilioCallSid: body.CallSid });
    sendTwiml(res, fallbackTwiml(inbound.routing));
  }
});

// ---------- AI leg ended or failed to connect ----------

inboundRouter.post('/webhooks/inbound/twilio/ai-ended', async (req: Request, res: Response): Promise<void> => {
  if (rejectUnsigned(req, res)) return;
  const callId = String(req.query.callId ?? '');
  const status = String((req.body as Record<string, string>).DialCallStatus ?? '');

  if (status === 'completed') {
    sendTwiml(res, twiml('  <Hangup/>'));
    return;
  }

  const { config: inbound } = await loadInboundSettings();
  logger.warn('Inbound AI leg failed; falling back', { inboundCallId: callId, dialStatus: status });
  const state = callId ? await loadIntakeForCall(callId) : null;
  await writeAudit({ callId, intakeId: state?.intakeId }, { type: 'TRANSFER_FAILED', actor: 'SYSTEM', data: { leg: 'ai', dial_status: status, fallback: inbound.routing.disabled_behavior } });
  sendTwiml(res, fallbackTwiml(inbound.routing));
  if (callId) void finalizeInboundCall(callId, `ai_unavailable:${status}`, { force: true });
});

// ---------- Transfer outcome ----------

inboundRouter.post('/webhooks/inbound/twilio/transfer-result', async (req: Request, res: Response): Promise<void> => {
  if (rejectUnsigned(req, res)) return;
  const callId = String(req.query.callId ?? '');
  const label = String(req.query.label ?? '');
  const dialStatus = String((req.body as Record<string, string>).DialCallStatus ?? '');
  const connected = dialStatus === 'completed' || dialStatus === 'answered';

  const [state, call, settings] = await Promise.all([loadIntakeForCall(callId), getInboundCall(callId), loadInboundSettings()]);
  if (!state || !call) {
    sendTwiml(res, twiml('  <Hangup/>'));
    return;
  }

  const attempt = [...state.transfers].reverse().find((t) => t.label === label && t.success === null);
  if (attempt) {
    attempt.success = connected;
    attempt.failureReason = connected ? null : dialStatus || 'no_answer';
  }
  state.transferInProgress = false;
  const ids = { callId, intakeId: state.intakeId };

  if (connected) {
    await writeAudit(ids, { type: 'TRANSFER_SUCCEEDED', actor: 'SYSTEM', data: { target: label } });
    state.status = deriveIntakeStatus(state);
    await saveIntakeState(state);
    await updateInboundCall(callId, { transfer_status: 'connected', status: 'transferred' });
    sendTwiml(res, twiml('  <Hangup/>'));
    void finalizeInboundCall(callId, 'transferred', { force: true });
    return;
  }

  await writeAudit(ids, { type: 'TRANSFER_FAILED', actor: 'SYSTEM', data: { target: label, dial_status: dialStatus } });

  const actions = computeAvailableActions(state, settings.config, getBusinessStatus(settings.config.business_hours), new Date());
  if (actions.canTransfer && actions.nextTransferTarget) {
    const target = actions.nextTransferTarget;
    state.transfers.push({ destination: target.number, label: target.label, startedAt: new Date().toISOString(), success: null, failureReason: null });
    state.transferInProgress = true;
    await writeAudit(ids, { type: 'TRANSFER_ATTEMPTED', actor: 'SYSTEM', data: { target: target.label, reason: `${label} did not answer` } });
    await saveIntakeState(state);
    await updateInboundCall(callId, { transferred_to: target.label, transfer_status: 'ringing' });
    sendTwiml(
      res,
      transferDialTwiml({
        inboundCallId: callId,
        target,
        timeoutSeconds: settings.config.routing.transfer_timeout_seconds,
        callerId: call.from_number,
        preamble: state.language === 'es' ? 'Un momento, por favor.' : 'One moment please.',
      }),
    );
    return;
  }

  // Nobody answered: bring the caller back to the AI, which knows the transfer failed.
  state.status = deriveIntakeStatus(state);
  await saveIntakeState(state);
  await updateInboundCall(callId, { transfer_status: 'failed', status: 'in_progress' });
  sendTwiml(res, sipBridgeTwiml(callId, true));
});

// ---------- Whisper to the staff member who answers a transfer ----------

inboundRouter.post('/webhooks/inbound/twilio/whisper', async (req: Request, res: Response): Promise<void> => {
  if (rejectUnsigned(req, res)) return;
  const state = await loadIntakeForCall(String(req.query.callId ?? ''));
  const f = state?.facts;
  const parts = [
    'Ramos James intake transfer.',
    state?.highPriority || state?.qualification?.result === 'high_priority' ? 'High priority.' : '',
    f?.caller_type === 'existing_client' ? 'Existing client.' : '',
    f?.caller_name ? `Caller: ${f.caller_name}.` : '',
    f?.case_type ? `${INBOUND_CASE_TYPE_LABELS[f.case_type]}.` : '',
    state?.language === 'es' ? 'Caller speaks Spanish.' : '',
    'Connecting now.',
  ].filter(Boolean);
  sendTwiml(res, twiml(`  <Say>${escapeXml(parts.join(' '))}</Say>`));
});

// ---------- Call status (set as the AI intake number's status callback) ----------

inboundRouter.post('/webhooks/inbound/twilio/status', async (req: Request, res: Response): Promise<void> => {
  if (rejectUnsigned(req, res)) return;
  res.status(204).end();
  const { CallSid, CallStatus } = req.body as Record<string, string>;
  if (!CallSid || !['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(CallStatus ?? '')) return;
  const call = await getInboundCallBySid(CallSid);
  if (call) void finalizeInboundCall(call.id, `twilio:${CallStatus}`, { force: true });
});

// ---------- E-signature status webhook ----------

inboundRouter.post('/webhooks/inbound/contracts/:provider', async (req: Request, res: Response): Promise<void> => {
  const secret = config.INBOUND_CONTRACT_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'Contract webhook not configured' });
    return;
  }
  const provided = String(req.headers['x-inbound-contract-secret'] ?? '');
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = (req.body ?? {}) as { intake_id?: string; external_id?: string; status?: string };
  let intakeId = body.intake_id ?? null;
  if (!intakeId && body.external_id) {
    const { data } = await supabase.from('inbound_intakes').select('id').eq('contract_external_id', body.external_id).maybeSingle();
    intakeId = (data?.id as string | undefined) ?? null;
  }
  const state = intakeId ? await loadIntakeById(intakeId) : null;
  if (!state) {
    res.status(404).json({ error: 'Intake not found' });
    return;
  }

  if (body.status === 'signed' && !state.contract.signed) {
    state.contract.signed = true;
    state.contract.signedAt = new Date().toISOString();
    state.status = deriveIntakeStatus(state);
    await saveIntakeState(state);
    await writeAudit(
      { callId: state.callId, intakeId: state.intakeId },
      { type: 'CONTRACT_SIGNED', actor: 'SYSTEM', data: { provider: req.params.provider, external_id: body.external_id ?? null } },
    );
  }
  res.status(200).json({ ok: true, status: state.status });
});

// ---------- Text Test Agent (called by the web app) ----------

inboundRouter.post('/internal/inbound/simulate', async (req: Request, res: Response): Promise<void> => {
  const auth = (req.headers['x-internal-secret'] as string | undefined) ?? (req.headers['x-voice-worker-secret'] as string | undefined);
  if (!auth || auth !== config.VOICE_WORKER_INTERNAL_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const parsed = simulateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }
  try {
    res.status(200).json(await runSimulationTurn(parsed.data));
  } catch (err) {
    logger.error('Inbound simulation failed', { error: err });
    res.status(500).json({ error: err instanceof Error ? err.message : 'Simulation failed' });
  }
});
