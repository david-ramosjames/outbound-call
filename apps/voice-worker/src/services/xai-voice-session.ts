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
import type { CallMission, VoiceSettings } from '@outbound-call/shared';

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

  constructor(missionId: string, callSessionId: string) {
    this.missionId = missionId;
    this.callSessionId = callSessionId;
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
    const wsUrl = isSipCall
      ? `${config.XAI_REALTIME_URL}?call_id=${encodeURIComponent(callId)}`
      : `${config.XAI_REALTIME_URL}?agent_id=${encodeURIComponent(config.XAI_AGENT_ID)}`;

    logger.info('xAI WebSocket URL mode', {
      ...logCtx,
      mode: isSipCall ? 'sip_call_id' : 'agent_id',
    });

    this.ws = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${config.XAI_API_KEY}`,
      },
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

        this.sendSessionUpdate(mission, vs);
        this.sendInitialGreeting();

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

  private sendSessionUpdate(
    mission: CallMission,
    voiceSettings: VoiceSettings
  ): void {
    const prompt = buildPrompt(mission, voiceSettings);

    // Save prompt snapshot
    supabase
      .from('call_missions')
      .update({ prompt_snapshot: prompt })
      .eq('id', this.missionId)
      .then();

    const sessionUpdate = {
      type: 'session.update',
      session: {
        instructions: prompt,
        tools: getToolDefinitions(),
        voice: voiceSettings.defaultVoice,
        turn_detection: { type: 'server_vad' },
        // Current xAI schema: enable user-side transcription so we receive
        // conversation.item.input_audio_transcription.completed events.
        audio: {
          input: {
            transcription: { model: 'grok-transcribe' },
          },
        },
      },
    };

    this.send(sessionUpdate);
    this.emitCallEvent('agent_session_configured', {
      voice: voiceSettings.defaultVoice,
    });

    logger.info('Session configured', {
      missionId: this.missionId,
      callSessionId: this.callSessionId,
    });
  }

  private sendInitialGreeting(): void {
    this.send({
      type: 'response.create',
      response: {
        modalities: ['audio', 'text'],
      },
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
      case 'session.updated':
        logger.debug(`xAI session event: ${type}`, {
          missionId: this.missionId,
        });
        break;

      case 'input_audio_buffer.speech_started':
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

    const seq = ++this.transcriptSeq;
    const endMs = Date.now() - this.sessionStartMs;
    const startMs = Math.max(0, endMs - 3000);

    await this.saveTranscriptSegment(
      'insurance_representative',
      transcript,
      seq,
      startMs,
      endMs
    );
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
    this.sendToolResult(callId, result);
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
      errorMessage: error?.message as string,
      errorCode: error?.code as string,
    });
  }

  private sendToolResult(callId: string, result: string): void {
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: result,
      },
    });

    this.send({
      type: 'response.create',
    });
  }

  async disconnect(reason?: string): Promise<void> {
    if (this.disconnecting) return;
    this.disconnecting = true;

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
  ): Promise<void> {
    const { error } = await supabase.from('call_transcript_segments').insert({
      id: uuidv4(),
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
      return;
    }

    logger.info('Saved transcript segment', {
      missionId: this.missionId,
      callSessionId: this.callSessionId,
      speaker,
      sequenceNumber: seq,
      chars: text.length,
    });
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
