import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import {
  AGREEMENT_STATUSES,
  applyAgreementStatus,
  computeAvailableActions,
  deriveIntakeStatus,
  getBusinessStatus,
  INBOUND_CASE_TYPE_LABELS,
  type AgreementStatus,
} from '@outbound-call/shared';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { listOpenaiVoices, listXaiVoices, previewOpenaiVoice, previewXaiVoice } from '../services/xai-voices.js';
import { openaiConfigured } from '../services/realtime-provider.js';
import { signflowFetch } from './contract-service.js';
import { finalizeInboundCall } from './finalize.js';
import { runSimulationTurn, simulateRequestSchema } from './simulate.js';
import {
  createInboundCallWithIntake,
  getInboundCall,
  getInboundCallBySid,
  listActiveLines,
  loadIntakeById,
  loadIntegrations,
  loadLineSettings,
  resolveLineForNumber,
  loadIntakeForCall,
  saveIntakeState,
  updateInboundCall,
  writeAudit,
} from './store.js';
import { escapeXml, fallbackTwiml, sipBridgeTwiml, transferDialTwiml, twiml, validateTwilioRequest } from './telephony.js';
import { getActiveInboundSession } from './voice-session.js';

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
  const { line, config: inbound } = await resolveLineForNumber(body.To ?? null, true);

  try {
    const business = getBusinessStatus(inbound.business_hours);
    const aiAllowed =
      inbound.flags.inbound_enabled &&
      inbound.flags.inbound_voice_enabled &&
      (business.status === 'business_hours' || inbound.flags.after_hours_ai_enabled);

    if (!aiAllowed) {
      logger.info('Inbound AI disabled; using fallback routing', { twilioCallSid: body.CallSid, line: line.slug });
      sendTwiml(res, fallbackTwiml(inbound));
      return;
    }

    const created = await createInboundCallWithIntake({
      twilioCallSid: body.CallSid ?? null,
      from: body.From ?? null,
      to: body.To ?? null,
      forwardedFrom: body.ForwardedFrom ?? null,
      businessStatus: business.status,
      lineId: line.id,
    });
    if (!created) {
      sendTwiml(res, fallbackTwiml(inbound));
      return;
    }

    await writeAudit(
      { callId: created.callId, intakeId: created.intakeId },
      {
        type: 'CALL_STARTED',
        actor: 'SYSTEM',
        data: { business_status: business.status, forwarded_from: body.ForwardedFrom ?? null, line: line.slug || null },
      },
    );
    sendTwiml(res, sipBridgeTwiml(created.callId, false, inbound.routing.voice_provider));
  } catch (err) {
    logger.error('Inbound voice webhook failed', { error: err, twilioCallSid: body.CallSid });
    sendTwiml(res, fallbackTwiml(inbound));
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

  const call = callId ? await getInboundCall(callId) : null;
  const { config: inbound } = await loadLineSettings(call?.line_id);
  logger.warn('Inbound AI leg failed; falling back', { inboundCallId: callId, dialStatus: status });
  const state = callId ? await loadIntakeForCall(callId) : null;
  await writeAudit({ callId, intakeId: state?.intakeId }, { type: 'TRANSFER_FAILED', actor: 'SYSTEM', data: { leg: 'ai', dial_status: status, fallback: inbound.routing.disabled_behavior } });
  sendTwiml(res, fallbackTwiml(inbound));
  if (callId) void finalizeInboundCall(callId, `ai_unavailable:${status}`, { force: true });
});

// ---------- Transfer outcome ----------

inboundRouter.post('/webhooks/inbound/twilio/transfer-result', async (req: Request, res: Response): Promise<void> => {
  if (rejectUnsigned(req, res)) return;
  const callId = String(req.query.callId ?? '');
  const label = String(req.query.label ?? '');
  const dialStatus = String((req.body as Record<string, string>).DialCallStatus ?? '');
  const connected = dialStatus === 'completed' || dialStatus === 'answered';

  const [state, call] = await Promise.all([loadIntakeForCall(callId), getInboundCall(callId)]);
  if (!state || !call) {
    sendTwiml(res, twiml('  <Hangup/>'));
    return;
  }
  const settings = await loadLineSettings(call.line_id);

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
  sendTwiml(res, sipBridgeTwiml(callId, true, settings.config.routing.voice_provider));
});

// ---------- Whisper to the staff member who answers a transfer ----------

inboundRouter.post('/webhooks/inbound/twilio/whisper', async (req: Request, res: Response): Promise<void> => {
  if (rejectUnsigned(req, res)) return;
  const callId = String(req.query.callId ?? '');
  const [state, call] = await Promise.all([loadIntakeForCall(callId), getInboundCall(callId)]);
  const { config: inbound } = await loadLineSettings(call?.line_id);
  const f = state?.facts;
  const parts = [
    `${inbound.firm_name} intake transfer.`,
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

function safeEqual(provided: string, secret: string): boolean {
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

inboundRouter.post('/webhooks/inbound/contracts/:provider', async (req: Request, res: Response): Promise<void> => {
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const legacy = String(req.headers['x-inbound-contract-secret'] ?? '');
  const authorized =
    (req.params.provider === 'signflow' && safeEqual(bearer, config.SIGNFLOW_INTAKE_TOKEN)) ||
    safeEqual(legacy, config.INBOUND_CONTRACT_WEBHOOK_SECRET);
  if (!authorized) {
    if (!config.SIGNFLOW_INTAKE_TOKEN && !config.INBOUND_CONTRACT_WEBHOOK_SECRET) {
      res.status(503).json({ error: 'Contract webhook not configured' });
      return;
    }
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = (req.body ?? {}) as { intake_id?: string; external_id?: string; status?: string };
  const status = body.status as AgreementStatus | undefined;
  if (!status || !(AGREEMENT_STATUSES as readonly string[]).includes(status)) {
    res.status(400).json({ error: 'Unknown status' });
    return;
  }
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
  if (body.external_id && state.contract.externalId && body.external_id !== state.contract.externalId) {
    res.status(409).json({ error: 'Signing request does not match this intake' });
    return;
  }
  const source = `webhook:${req.params.provider}`;

  // Caller still on the line: the live session owns the state and tells the agent.
  const session = state.callId ? getActiveInboundSession(state.callId) : undefined;
  if (session) {
    res.status(200).json({ ok: true, ...(await session.applyContractEvent(status, source)) });
    return;
  }

  const ids = { callId: state.callId, intakeId: state.intakeId };
  if (await applyAgreementStatus(state, status, (e) => writeAudit(ids, e), new Date(), source)) {
    state.status = deriveIntakeStatus(state);
    await saveIntakeState(state);
  }
  res.status(200).json({ ok: true, status: state.status });
});

// ---------- Internal endpoints (called by the web app) ----------

function rejectInternal(req: Request, res: Response): boolean {
  const auth = (req.headers['x-internal-secret'] as string | undefined) ?? (req.headers['x-voice-worker-secret'] as string | undefined);
  if (safeEqual(auth ?? '', config.VOICE_WORKER_INTERNAL_SECRET)) return false;
  res.status(401).json({ error: 'Unauthorized' });
  return true;
}

/** Which worker env vars are set (booleans only, never values) plus the derived webhook URLs. */
inboundRouter.get('/internal/inbound/env-status', async (req: Request, res: Response): Promise<void> => {
  if (rejectInternal(req, res)) return;
  const set = (v: string | undefined) => Boolean(v && v.trim() && !v.startsWith('mock-'));
  const base = config.VOICE_WORKER_BASE_URL.replace(/\/$/, '');
  const integrations = await loadIntegrations(true);
  res.json({
    mode: config.VOICE_MODE,
    env: {
      SUPABASE_URL: set(config.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: set(config.SUPABASE_SERVICE_ROLE_KEY),
      XAI_API_KEY: set(config.XAI_API_KEY),
      XAI_AGENT_ID: set(config.XAI_AGENT_ID),
      XAI_SIP_URI: set(config.XAI_SIP_URI) && !config.XAI_SIP_URI.includes('mock@'),
      XAI_SIP_WEBHOOK_SECRET: set(config.XAI_SIP_WEBHOOK_SECRET),
      TWILIO_ACCOUNT_SID: set(config.TWILIO_ACCOUNT_SID),
      TWILIO_AUTH_TOKEN: set(config.TWILIO_AUTH_TOKEN),
      TWILIO_PHONE_NUMBER: set(config.TWILIO_PHONE_NUMBER) && config.TWILIO_PHONE_NUMBER !== '+10000000000',
      VOICE_WORKER_INTERNAL_SECRET: set(config.VOICE_WORKER_INTERNAL_SECRET),
      VOICE_WORKER_BASE_URL: base.startsWith('https://'),
      APP_BASE_URL: !config.APP_BASE_URL.includes('localhost'),
      SIGNFLOW_INTAKE_TOKEN: set(config.SIGNFLOW_INTAKE_TOKEN),
      OPENAI_API_KEY: set(config.OPENAI_API_KEY),
      OPENAI_PROJECT_ID: set(config.OPENAI_PROJECT_ID),
      OPENAI_WEBHOOK_SECRET: set(config.OPENAI_WEBHOOK_SECRET),
      INBOUND_CONTRACT_WEBHOOK_SECRET: set(config.INBOUND_CONTRACT_WEBHOOK_SECRET),
      SLACK_BOT_TOKEN: set(config.SLACK_BOT_TOKEN),
    },
    urls: {
      voice: `${base}/webhooks/inbound/twilio/voice`,
      status: `${base}/webhooks/inbound/twilio/status`,
      signflowCallback: `${base}/webhooks/inbound/contracts/signflow`,
      xaiWebhook: `${base}/webhooks/xai/sip`,
      openaiWebhook: `${base}/webhooks/openai/sip`,
    },
    integrations,
    lines: (await listActiveLines()).map((l) => ({ id: l.id, name: l.name, phone_numbers: l.phone_numbers, is_default: l.is_default })),
  });
});

/** Sign Flow connection check: its firms (accounts) and which of its env vars are set. */
inboundRouter.get('/internal/inbound/signflow/health', async (req: Request, res: Response): Promise<void> => {
  if (rejectInternal(req, res)) return;
  const r = await signflowFetch('/api/intake/health');
  res.status(r.ok ? 200 : 502).json(r.ok ? r.body : { ok: false, error: r.error });
});

inboundRouter.get('/internal/inbound/signflow/templates', async (req: Request, res: Response): Promise<void> => {
  if (rejectInternal(req, res)) return;
  const firmId = String(req.query.firmId ?? '').trim();
  const r = await signflowFetch(`/api/intake/templates${firmId ? `?firmId=${encodeURIComponent(firmId)}` : ''}`);
  res.status(r.ok ? 200 : 502).json(r.ok ? r.body : { ok: false, error: r.error });
});

inboundRouter.get('/internal/inbound/signflow/templates/:id', async (req: Request, res: Response): Promise<void> => {
  if (rejectInternal(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid template id' });
    return;
  }
  const firmId = String(req.query.firmId ?? '').trim();
  const r = await signflowFetch(`/api/intake/templates/${id}${firmId ? `?firmId=${encodeURIComponent(firmId)}` : ''}`);
  res.status(r.ok ? 200 : 502).json(r.ok ? r.body : { ok: false, error: r.error });
});

// ---------- xAI voices (shared by outbound and inbound settings) ----------

/** Which voice providers have their keys set on the worker. */
inboundRouter.get('/internal/voices/providers', (req: Request, res: Response): void => {
  if (rejectInternal(req, res)) return;
  res.json({ xai: Boolean(config.XAI_API_KEY.trim()), openai: openaiConfigured() });
});

inboundRouter.get('/internal/voices', async (req: Request, res: Response): Promise<void> => {
  if (rejectInternal(req, res)) return;
  if (req.query.provider === 'openai') {
    res.json({ voices: listOpenaiVoices(), live: true, configured: openaiConfigured() });
    return;
  }
  res.json({ ...(await listXaiVoices(req.query.refresh === '1')), configured: true });
});

inboundRouter.post('/internal/voices/preview', async (req: Request, res: Response): Promise<void> => {
  if (rejectInternal(req, res)) return;
  const voice = String(req.body?.voice ?? '').trim().toLowerCase();
  const text = String(req.body?.text ?? '').trim().slice(0, 300);
  const provider = req.body?.provider === 'openai' ? 'openai' : 'xai';
  if (!/^[a-z0-9_-]{2,40}$/.test(voice) || !text) {
    res.status(400).json({ error: 'voice and text are required' });
    return;
  }
  try {
    const audio = provider === 'openai' ? await previewOpenaiVoice(voice, text) : await previewXaiVoice(voice, text);
    res.json({ mime: 'audio/mpeg', audio: audio.toString('base64') });
  } catch (err) {
    logger.warn('Voice preview failed', { voice, error: err });
    res.status(502).json({ error: err instanceof Error ? err.message : 'Preview failed' });
  }
});

// ---------- Text Test Agent ----------

inboundRouter.post('/internal/inbound/simulate', async (req: Request, res: Response): Promise<void> => {
  if (rejectInternal(req, res)) return;
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
