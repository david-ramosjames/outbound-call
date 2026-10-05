import WebSocket from 'ws';
import {
  agreementStatusGuidance,
  applyAgreementStatus,
  availableActionsFor,
  buildInboundGreeting,
  buildInboundInstructions,
  businessStatusFor,
  checkAgentUtterance,
  deriveIntakeStatus,
  executeInboundTool,
  getInboundToolDefinitions,
  type AgreementStatus,
  type InboundIntakeState,
  type InboundRuntime,
} from '@outbound-call/shared';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { normalizeXaiVoice } from '../services/map-mission.js';
import { finalizeInboundCall } from './finalize.js';
import { createLiveRuntime } from './runtime.js';
import { getInboundCall, loadIntakeForCall, loadLineSettings, saveTranscript, updateInboundCall, type InboundCallRow } from './store.js';
import { hangUpCall } from './telephony.js';

const activeSessions = new Map<string, InboundVoiceSession>();

export function getActiveInboundSession(callId: string): InboundVoiceSession | undefined {
  return activeSessions.get(callId);
}

export class InboundVoiceSession {
  private ws: WebSocket | null = null;
  private state!: InboundIntakeState;
  private runtime!: InboundRuntime;
  private call!: InboundCallRow;
  private agentText = '';
  private greetingSent = false;
  private closing = false;
  private responseActive = false;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly callId: string,
    private readonly xaiCallId: string,
    private readonly resumed: boolean,
  ) {}

  private get logCtx() {
    return { inboundCallId: this.callId, xaiCallId: this.xaiCallId };
  }

  async start(): Promise<void> {
    const [call, state] = await Promise.all([getInboundCall(this.callId), loadIntakeForCall(this.callId)]);
    if (!call || !state) {
      logger.error('Inbound session: call or intake missing', this.logCtx);
      return;
    }
    const settings = await loadLineSettings(call.line_id, true);
    this.call = call;
    this.state = state;
    this.state.transferInProgress = false;
    this.runtime = createLiveRuntime({
      config: settings.config,
      instructions: settings.instructions,
      call,
      state,
      signflowFirmId: settings.line.signflow_firm_id,
    });
    activeSessions.set(this.callId, this);

    await updateInboundCall(this.callId, {
      xai_call_id: this.xaiCallId,
      status: 'in_progress',
      ...(call.answered_at ? {} : { answered_at: new Date().toISOString() }),
    });

    this.ws = new WebSocket(`${config.XAI_REALTIME_URL}?call_id=${encodeURIComponent(this.xaiCallId)}`, {
      headers: { Authorization: `Bearer ${config.XAI_API_KEY}` },
    });

    this.ws.on('open', () => {
      logger.info('Inbound xAI WebSocket connected', this.logCtx);
      this.sendSessionUpdate();
      setTimeout(() => this.sendGreeting(), 2500);
      this.maxTimer = setTimeout(() => {
        logger.warn('Inbound call reached max duration', this.logCtx);
        void this.end('max_duration');
      }, settings.config.routing.max_call_seconds * 1000);
    });

    this.ws.on('message', (data) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.handleEvent(event).catch((err) => logger.error('Inbound xAI event handling failed', { ...this.logCtx, error: err }));
    });

    this.ws.on('error', (err) => logger.error('Inbound xAI WebSocket error', { ...this.logCtx, error: err, errorCategory: 'xai_websocket' }));

    this.ws.on('close', () => {
      if (this.maxTimer) clearTimeout(this.maxTimer);
      activeSessions.delete(this.callId);
      void this.flushAgentText();
      if (this.state.transferInProgress) {
        logger.info('Inbound AI leg closed for transfer', this.logCtx);
        return;
      }
      // Give a late tool call or Twilio status a moment before closing out.
      setTimeout(() => void finalizeInboundCall(this.callId, this.closing ? 'agent_ended' : 'caller_hung_up'), 3000);
    });
  }

  private sendSessionUpdate(): void {
    const business = businessStatusFor(this.runtime);
    const ctx = {
      instructions: this.runtime.instructions,
      config: this.runtime.config,
      state: this.state,
      business,
      now: new Date(),
      resumedAfterTransfer: this.resumed,
    };
    const greeting = buildInboundGreeting(ctx);
    const instructions = `${buildInboundInstructions(ctx)}\n\n# Opening line\nStart the call by saying exactly: "${greeting}"`;

    this.send({
      type: 'session.update',
      session: {
        instructions,
        tools: getInboundToolDefinitions(),
        voice: normalizeXaiVoice(this.runtime.config.routing.voice),
        turn_detection: { type: 'server_vad' },
        audio: { input: { transcription: { model: 'grok-transcribe' } } },
      },
    });
    void updateInboundCall(this.callId, { business_status: business.status, language: this.state.language });
  }

  private sendGreeting(): void {
    if (this.greetingSent || this.closing) return;
    this.greetingSent = true;
    this.send({ type: 'response.create' });
  }

  private async handleEvent(event: Record<string, unknown>): Promise<void> {
    switch (event.type as string) {
      case 'session.updated':
        this.sendGreeting();
        break;
      case 'response.created':
        this.responseActive = true;
        break;
      case 'response.done':
        this.responseActive = false;
        break;
      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta':
        this.agentText += String(event.delta ?? '');
        break;
      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done': {
        const text = String(event.transcript ?? '') || this.agentText;
        this.agentText = '';
        await this.recordAgentText(text);
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(event.transcript ?? '').trim();
        if (text) await saveTranscript(this.callId, 'caller', text, this.state.language);
        break;
      }
      case 'response.function_call_arguments.done':
        await this.handleToolCall(event);
        break;
      case 'error':
        logger.error('Inbound xAI realtime error', { ...this.logCtx, eventJson: JSON.stringify(event).slice(0, 800), errorCategory: 'xai_realtime' });
        break;
      default:
        break;
    }
  }

  private async flushAgentText(): Promise<void> {
    const pending = this.agentText;
    this.agentText = '';
    await this.recordAgentText(pending);
  }

  private async recordAgentText(text: string): Promise<void> {
    if (!text.trim()) return;
    await saveTranscript(this.callId, 'agent', text, this.state.language);
    const violations = checkAgentUtterance(text);
    if (violations.length === 0) return;
    await this.runtime.audit({ type: 'GUARDRAIL_FLAGGED', actor: 'SYSTEM', data: { violations, text: text.slice(0, 500) } });
    const reason = `AI statement flagged for review (${violations.map((v) => v.category).join(', ')})`;
    if (!this.state.needsReviewReasons.includes(reason)) {
      this.state.needsReviewReasons.push(reason);
      await this.runtime.persist(this.state);
    }
  }

  private async handleToolCall(event: Record<string, unknown>): Promise<void> {
    const name = String(event.name ?? '');
    const toolCallId = String(event.call_id ?? '');
    let args: unknown = {};
    try {
      args = event.arguments ? JSON.parse(String(event.arguments)) : {};
    } catch {
      this.sendToolResult(toolCallId, { ok: false, error: 'Arguments were not valid JSON' });
      return;
    }

    logger.info(`Inbound tool call: ${name}`, { ...this.logCtx, eventType: 'tool_call_requested' });
    const result = await executeInboundTool(name, args, this.state, this.runtime);

    if (result.transferStarted && result.endCall === undefined) {
      // Twilio is moving the caller to a human; the AI leg will drop on its own.
      this.sendToolResult(toolCallId, result.output, false);
      return;
    }
    this.sendToolResult(toolCallId, result.output);
    if (result.endCall) setTimeout(() => void this.end('agent_end_call'), 4000);
  }

  private sendToolResult(callId: string, output: Record<string, unknown>, respond = true): void {
    this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) } });
    if (respond) this.send({ type: 'response.create' });
  }

  /** E-sign provider reported a status change while the caller is still on the line. */
  async applyContractEvent(status: AgreementStatus, source: string): Promise<{ status: string }> {
    const changed = await applyAgreementStatus(this.state, status, this.runtime.audit, new Date(), source);
    if (!changed) return { status: this.state.status };
    this.state.status = deriveIntakeStatus(this.state);
    this.state.recommendedNextAction = availableActionsFor(this.state, this.runtime).recommendedNextAction;
    await this.runtime.persist(this.state);

    const c = this.state.contract;
    const note = c.signed
      ? 'The caller has just SIGNED the engagement agreement (confirmed by the e-signature system).'
      : c.closedReason
        ? `The engagement agreement was ${c.closedReason} in the e-signature system.`
        : 'The caller has just opened the engagement agreement.';
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: `System note: ${note} ${agreementStatusGuidance(this.state, true)}` }],
      },
    });
    // Speak up for the important moments, but don't talk over the agent or the caller mid-turn.
    if ((c.signed || c.closedReason) && !this.responseActive && !this.closing) this.send({ type: 'response.create' });
    await saveTranscript(this.callId, 'system', note, this.state.language);
    return { status: this.state.status };
  }

  async end(reason: string): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (this.call.twilio_call_sid && !this.state.transferInProgress) await hangUpCall(this.call.twilio_call_sid);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close(1000, reason);
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
}
