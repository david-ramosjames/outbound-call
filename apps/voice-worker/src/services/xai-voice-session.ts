import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { buildPrompt } from './prompt-builder.js';
import {
  getToolDefinitions,
  dispatchToolCall,
  type ToolCallContext,
} from './grok-tools.js';
import { processCallResults } from './post-call-processor.js';
import { mapDbVoiceSettings } from './map-mission.js';
import { acceptCall, buildRealtimeSession, openRealtimeSocket, voiceFor } from './realtime-provider.js';
import { endKeypadConference, keypadConferenceFor } from './keypad.js';
import type { CallMission, VoiceProvider, VoiceSettings } from '@outbound-call/shared';

const normalizeCaption = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

interface TranscriptAccumulator {
  responseId: string;
  text: string;
  startTimeMs: number;
}

export class XaiVoiceSession {
  private ws: WebSocket | null = null;
  private missionId: string;
  private callSessionId: string;
  private transcriptSeq = 0;
  private currentTranscript: TranscriptAccumulator | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionStartMs = 0;
  private disconnecting = false;
  private lastRepSegment: { id: string; itemId: string | null; text: string; seq: number; endMs: number } | null = null;
  private greetingSent = false;
  private keypadMode = false;
  private repHasSpoken = false;
  private pendingGreeting = false;
  private aiLegJoined = false;
  private greetingAwaitingJoin = false;

  private static byMission = new Map<string, XaiVoiceSession>();
  /** Join events that arrive before the session registers (rare). */
  private static earlyJoins = new Set<string>();

  /** Keypad mode: Twilio reports the AI's leg is in the conference, so audio now reaches the carrier. */
  static notifyAiLegJoined(missionId: string): void {
    const session = XaiVoiceSession.byMission.get(missionId);
    if (!session) {
      XaiVoiceSession.earlyJoins.add(missionId);
      setTimeout(() => XaiVoiceSession.earlyJoins.delete(missionId), 30_000);
      return;
    }
    session.onAiLegJoined();
  }

  constructor(
    missionId: string,
    callSessionId: string,
    private readonly provider: VoiceProvider = 'xai',
  ) {
    this.missionId = missionId;
    this.callSessionId = callSessionId;
    XaiVoiceSession.byMission.set(missionId, this);
    if (XaiVoiceSession.earlyJoins.delete(missionId)) this.aiLegJoined = true;
  }

  private onAiLegJoined(): void {
    if (this.aiLegJoined) return;
    this.aiLegJoined = true;
    if (this.greetingAwaitingJoin) {
      this.greetingAwaitingJoin = false;
      if (!this.repHasSpoken) this.requestGreeting();
    }
  }

  async connect(callId: string, mission: CallMission): Promise<void> {
    const logCtx = {
      missionId: this.missionId,
      callSessionId: this.callSessionId,
      xaiCallId: callId,
    };

    logger.info('Opening xAI WebSocket', logCtx);

    // Fetch voice settings
    const { data: voiceSettingsRow } = await supabase
      .from('voice_settings')
      .select('*')
      .limit(1)
      .single();

    const vs = mapDbVoiceSettings(voiceSettingsRow as Record<string, unknown> | null);

    // SIP calls must join with call_id from realtime.call.incoming.
    // Direct (non-SIP) sessions can still use agent_id.
    const isSipCall = Boolean(callId) && callId !== this.missionId;

    logger.info('Realtime WebSocket URL mode', {
      ...logCtx,
      provider: this.provider,
      mode: isSipCall ? 'sip_call_id' : 'agent_id',
    });

    if (this.provider === 'openai') {
      // OpenAI keeps the SIP leg ringing until we accept it with the session config.
      const accepted = await acceptCall('openai', callId, this.buildSession(mission, vs));
      if (!accepted) {
        this.updateSessionStatus('error');
        this.emitCallEvent('agent_session_failed', { provider: 'openai', xaiCallId: callId });
        return;
      }
    }

    this.ws =
      isSipCall || this.provider === 'openai'
        ? openRealtimeSocket(this.provider, callId)
        : new WebSocket(`${config.XAI_REALTIME_URL}?agent_id=${encodeURIComponent(config.XAI_AGENT_ID)}`, {
            headers: { Authorization: `Bearer ${config.XAI_API_KEY}` },
          });

    this.sessionStartMs = Date.now();

    this.ws.on('open', () => {
      logger.info('xAI WebSocket connected', logCtx);

      try {
        this.updateSessionStatus('connected');
        this.emitCallEvent('xai_websocket_connected', {
          mode: isSipCall ? 'sip_call_id' : 'agent_id',
          xaiCallId: callId,
        });

        this.keypadMode = vs.keypadEnabled;
        this.sendSessionUpdate(mission, vs);
        // Defer spoken greeting until session.updated confirms config applied.
        this.pendingGreeting = true;
        // Fallback if session.updated never arrives
        setTimeout(() => {
          if (this.pendingGreeting && !this.greetingSent) {
            logger.warn('session.updated not received; sending greeting anyway', logCtx);
            this.sendInitialGreeting();
          }
        }, 2500);

        // Maximum call duration timer
        const maxMs = vs.maximumCallDurationSeconds * 1000;
        this.maxDurationTimer = setTimeout(() => {
          logger.warn('Maximum call duration reached', {
            ...logCtx,
            duration: vs.maximumCallDurationSeconds,
          });
          this.disconnect('max_duration_exceeded');
        }, maxMs);
      } catch (err) {
        logger.error('Failed during xAI WebSocket open handshake', {
          ...logCtx,
          error: err,
          errorCategory: 'xai_session',
        });
        this.disconnect('session_setup_failed');
      }
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleServerEvent(msg, mission).catch((err) => {
          logger.error('Error handling xAI event', {
            ...logCtx,
            error: err,
          });
        });
      } catch (err) {
        logger.error('Failed to parse xAI message', {
          ...logCtx,
          error: err,
        });
      }
    });

    this.ws.on('error', (err) => {
      logger.error('xAI WebSocket error', {
        ...logCtx,
        error: err,
        errorCategory: 'xai_websocket',
      });
      this.updateSessionStatus('error');
    });

    this.ws.on('close', (code, reason) => {
      logger.info('xAI WebSocket closed', {
        ...logCtx,
        status: `${code}`,
        reason: reason.toString(),
      });

      if (this.maxDurationTimer) {
        clearTimeout(this.maxDurationTimer);
        this.maxDurationTimer = null;
      }

      if (XaiVoiceSession.byMission.get(this.missionId) === this) XaiVoiceSession.byMission.delete(this.missionId);

      // Flush any in-flight AI transcript before teardown
      void this.flushPendingTranscript('websocket_closed');

      this.updateSessionStatus('disconnected');
      this.emitCallEvent('websocket_disconnected', {
        code,
        reason: reason.toString(),
      });

      if (!this.disconnecting) {
        this.onSessionEnded();
      }
    });
  }

  private sessionVoice(voiceSettings: VoiceSettings): string {
    return this.provider === 'openai' ? voiceSettings.openaiVoice : voiceSettings.defaultVoice;
  }

  private buildSession(mission: CallMission, voiceSettings: VoiceSettings): Record<string, unknown> {
    return buildRealtimeSession(this.provider, {
      instructions: buildPrompt(mission, voiceSettings),
      tools: getToolDefinitions({ keypad: voiceSettings.keypadEnabled }),
      voice: this.sessionVoice(voiceSettings),
    });
  }

  private sendSessionUpdate(
    mission: CallMission,
    voiceSettings: VoiceSettings
  ): void {
    const session = this.buildSession(mission, voiceSettings);

    // Save prompt snapshot
    supabase
      .from('call_missions')
      .update({ prompt_snapshot: session.instructions as string })
      .eq('id', this.missionId)
      .then();

    const voice = voiceFor(this.provider, this.sessionVoice(voiceSettings));

    this.send({ type: 'session.update', session });
    this.emitCallEvent('agent_session_configured', {
      voice,
      provider: this.provider,
    });

    logger.info('Session configured', {
      missionId: this.missionId,
      callSessionId: this.callSessionId,
      provider: this.provider,
      voice,
    });
  }

  private sendInitialGreeting(): void {
    if (this.greetingSent || this.disconnecting) return;
    this.greetingSent = true;
    this.pendingGreeting = false;
    // Keypad mode: xAI connects before Twilio has joined the AI leg to the conference; greet once it has
    // (Twilio join event), with a fallback in case that event never arrives.
    if (this.keypadMode && !this.aiLegJoined) {
      this.greetingAwaitingJoin = true;
      setTimeout(() => {
        if (!this.greetingAwaitingJoin) return;
        this.greetingAwaitingJoin = false;
        // If they already spoke, the AI is answering them; a second response.create would overlap it.
        if (!this.repHasSpoken) this.requestGreeting();
      }, 3000);
      return;
    }
    this.requestGreeting();
  }

  private requestGreeting(): void {
    if (this.disconnecting) return;

    // Do not send OpenAI-only `modalities` — xAI SIP sessions reject unknown fields.
    this.send({
      type: 'response.create',
    });

    logger.info('Initial greeting requested', {
      missionId: this.missionId,
      callSessionId: this.callSessionId,
    });
  }

  private async handleServerEvent(
    event: Record<string, unknown>,
    mission: CallMission
  ): Promise<void> {
    const type = event.type as string;

    switch (type) {
      case 'response.audio_transcript.delta':
        this.handleTranscriptDelta(event);
        break;

      case 'response.audio_transcript.done':
        await this.handleTranscriptDone(event);
        break;

      case 'conversation.item.input_audio_transcription.completed':
        await this.handleUserSpeech(event);
        break;

      // Cumulative live-caption updates; ignored for storage (we persist on completed)
      case 'conversation.item.input_audio_transcription.updated':
        break;

      case 'response.function_call_arguments.done':
        await this.handleFunctionCall(event, mission);
        break;

      case 'response.done':
        this.handleResponseDone(event);
        break;

      case 'error':
        this.handleError(event);
        break;

      case 'session.created':
        logger.info('xAI session.created', {
          missionId: this.missionId,
        });
        break;

      case 'session.updated':
        logger.info('xAI session.updated', {
          missionId: this.missionId,
        });
        if (this.pendingGreeting && !this.greetingSent) {
          this.sendInitialGreeting();
        }
        break;

      case 'input_audio_buffer.speech_started':
        this.repHasSpoken = true;
        this.emitCallEvent('representative_speech_started', {});
        break;

      case 'input_audio_buffer.speech_stopped':
        this.emitCallEvent('representative_speech_ended', {});
        break;

      case 'response.output_audio_transcript.delta':
        this.handleTranscriptDelta(event);
        break;

      case 'response.output_audio_transcript.done':
        await this.handleTranscriptDone(event);
        break;

      default:
        logger.info(`Unhandled xAI event: ${type}`, {
          missionId: this.missionId,
          eventType: type,
        });
    }
  }

  private handleTranscriptDelta(event: Record<string, unknown>): void {
    const responseId = event.response_id as string;
    const delta = event.delta as string;

    if (!this.currentTranscript || this.currentTranscript.responseId !== responseId) {
      this.currentTranscript = {
        responseId,
        text: '',
        startTimeMs: Date.now() - this.sessionStartMs,
      };
    }

    this.currentTranscript.text += delta;
  }

  private async handleTranscriptDone(
    event: Record<string, unknown>
  ): Promise<void> {
    const transcript = event.transcript as string;
    const finalText = transcript || this.currentTranscript?.text || '';

    if (!finalText.trim()) return;

    const seq = ++this.transcriptSeq;
    const startMs = this.currentTranscript?.startTimeMs ?? 0;
    const endMs = Date.now() - this.sessionStartMs;

    await this.saveTranscriptSegment('ai_agent', finalText, seq, startMs, endMs);

    this.currentTranscript = null;
  }

  private async handleUserSpeech(
    event: Record<string, unknown>
  ): Promise<void> {
    const transcript = event.transcript as string;
    if (!transcript?.trim()) return;

    const endMs = Date.now() - this.sessionStartMs;
    const itemId = typeof event.item_id === 'string' ? event.item_id : null;

    // xAI can send "completed" repeatedly for one utterance, each time with more words. Update that row instead
    // of adding a new one.
    const last = this.lastRepSegment;
    const sameUtterance =
      last &&
      this.transcriptSeq === last.seq &&
      (itemId && last.itemId
        ? itemId === last.itemId
        : endMs - last.endMs < 4000 && normalizeCaption(transcript).startsWith(normalizeCaption(last.text)));
    if (last && sameUtterance) {
      last.text = transcript;
      last.endMs = endMs;
      last.itemId = itemId ?? last.itemId;
      const { error } = await supabase
        .from('call_transcript_segments')
        .update({ text: transcript, end_time_ms: endMs })
        .eq('id', last.id);
      if (!error) return;
    }

    const seq = ++this.transcriptSeq;
    const startMs = Math.max(0, endMs - 3000);
    const id = await this.saveTranscriptSegment('insurance_representative', transcript, seq, startMs, endMs);
    this.lastRepSegment = id ? { id, itemId, text: transcript, seq, endMs } : null;
  }

  private async handleFunctionCall(
    event: Record<string, unknown>,
    mission: CallMission
  ): Promise<void> {
    const name = event.name as string;
    const callId = event.call_id as string;
    let args: unknown;

    try {
      args = JSON.parse(event.arguments as string);
    } catch {
      logger.error('Failed to parse tool call arguments', {
        missionId: this.missionId,
        eventType: 'tool_call_requested',
      });
      this.sendToolResult(callId, JSON.stringify({ error: 'invalid_arguments' }));
      return;
    }

    logger.info(`Tool call: ${name}`, {
      missionId: this.missionId,
      callSessionId: this.callSessionId,
      eventType: 'tool_call_requested',
    });

    const ctx: ToolCallContext = {
      missionId: this.missionId,
      callSessionId: this.callSessionId,
      mission,
      onEndCall: (status, reason) => {
        logger.info('End call requested by AI', {
          missionId: this.missionId,
          status,
        });
        setTimeout(() => this.disconnect(`end_call:${status}`), 2000);
      },
    };

    const result = await dispatchToolCall(name, args, ctx);
    // After a key press the AI should stay silent; it will reply when the phone menu speaks again.
    this.sendToolResult(callId, result, !(name === 'press_keys' && result.includes('"keys_pressed"')));
  }

  private handleResponseDone(event: Record<string, unknown>): void {
    logger.debug('Response completed', {
      missionId: this.missionId,
    });
  }

  private handleError(event: Record<string, unknown>): void {
    const error = event.error as Record<string, unknown> | undefined;
    logger.error('xAI realtime error', {
      missionId: this.missionId,
      callSessionId: this.callSessionId,
      errorCategory: 'xai_realtime',
      errorMessage: (error?.message as string) ?? String(event.message ?? ''),
      errorCode: error?.code as string | undefined,
      errorType: error?.type as string | undefined,
      eventJson: JSON.stringify(event).slice(0, 800),
    });
  }

  private sendToolResult(callId: string, result: string, respond = true): void {
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: result,
      },
    });

    if (respond) {
      this.send({
        type: 'response.create',
      });
    }
  }

  async disconnect(reason?: string): Promise<void> {
    if (this.disconnecting) return;
    this.disconnecting = true;
    if (XaiVoiceSession.byMission.get(this.missionId) === this) XaiVoiceSession.byMission.delete(this.missionId);

    logger.info('Disconnecting xAI session', {
      missionId: this.missionId,
      callSessionId: this.callSessionId,
      status: reason,
    });

    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }

    await this.flushPendingTranscript(reason ?? 'session_ended');

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, reason ?? 'session_ended');
    }

    const room = await keypadConferenceFor(this.callSessionId).catch(() => null);
    if (room) void endKeypadConference(room);

    await this.onSessionEnded();
  }

  private async flushPendingTranscript(reason: string): Promise<void> {
    const pending = this.currentTranscript?.text?.trim();
    if (!pending) {
      this.currentTranscript = null;
      return;
    }

    const seq = ++this.transcriptSeq;
    const startMs = this.currentTranscript?.startTimeMs ?? 0;
    const endMs = Date.now() - this.sessionStartMs;

    logger.warn('Flushing incomplete AI transcript on disconnect', {
      missionId: this.missionId,
      callSessionId: this.callSessionId,
      reason,
      chars: pending.length,
    });

    await this.saveTranscriptSegment('ai_agent', pending, seq, startMs, endMs);
    this.currentTranscript = null;
  }

  private async onSessionEnded(): Promise<void> {
    const durationMs = Date.now() - this.sessionStartMs;

    await supabase
      .from('call_sessions')
      .update({
        ended_at: new Date().toISOString(),
        xai_connection_status: 'disconnected',
      })
      .eq('id', this.callSessionId);

    await supabase
      .from('call_missions')
      .update({
        duration_seconds: Math.floor(durationMs / 1000),
        completed_at: new Date().toISOString(),
      })
      .eq('id', this.missionId);

    // Trigger post-call processing
    try {
      await processCallResults(this.missionId);
    } catch (err) {
      logger.error('Post-call processing failed', {
        missionId: this.missionId,
        error: err,
        errorCategory: 'post_call',
      });
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private async saveTranscriptSegment(
    speaker: string,
    text: string,
    seq: number,
    startMs: number,
    endMs: number
  ): Promise<string | null> {
    const id = uuidv4();
    const { error } = await supabase.from('call_transcript_segments').insert({
      id,
      call_mission_id: this.missionId,
      call_session_id: this.callSessionId,
      speaker,
      text,
      start_time_ms: startMs,
      end_time_ms: endMs,
      sequence_number: seq,
      is_final: true,
    });

    if (error) {
      logger.error('Failed to save transcript segment', {
        missionId: this.missionId,
        callSessionId: this.callSessionId,
        speaker,
        sequenceNumber: seq,
        errorMessage: error.message,
        errorCode: error.code,
        errorDetails: error.details,
        errorHint: error.hint,
      });
      return null;
    }

    logger.info('Saved transcript segment', {
      missionId: this.missionId,
      callSessionId: this.callSessionId,
      speaker,
      sequenceNumber: seq,
      chars: text.length,
    });
    return id;
  }

  private async updateSessionStatus(status: string): Promise<void> {
    await supabase
      .from('call_sessions')
      .update({ xai_connection_status: status })
      .eq('id', this.callSessionId);
  }

  private async emitCallEvent(
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await supabase.from('call_events').insert({
      id: uuidv4(),
      call_mission_id: this.missionId,
      call_session_id: this.callSessionId,
      source: 'xai',
      event_type: eventType,
      event_payload: payload,
      occurred_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      sequence_number: Date.now(),
    });
  }
}
