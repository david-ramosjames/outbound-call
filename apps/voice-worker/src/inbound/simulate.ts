import { z } from 'zod';
import {
  availableActionsFor,
  buildInboundGreeting,
  buildInboundInstructions,
  businessStatusFor,
  checkAgentUtterance,
  createMemoryRuntime,
  currentIntakeStage,
  executeInboundTool,
  formatIntakeSummary,
  getInboundChatToolDefinitions,
  getMissingFields,
  inboundConfigSchema,
  INBOUND_CASE_TYPES,
  INBOUND_LANGUAGES,
  BUSINESS_STATUSES,
  newIntakeState,
  type InboundConfig,
  type InboundIntakeState,
  type VoiceProvider,
} from '@outbound-call/shared';
import { config } from '../config.js';
import { loadLineSettings } from './store.js';

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string().nullable().optional(),
  tool_calls: z
    .array(z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string() }) }))
    .optional(),
  tool_call_id: z.string().optional(),
});
type ChatMessage = z.infer<typeof chatMessageSchema>;

export const simulateRequestSchema = z.object({
  lineId: z.string().uuid().nullable().optional(),
  messages: z.array(chatMessageSchema).max(200).default([]),
  userMessage: z.string().max(4000).default(''),
  state: z.record(z.unknown()).nullable().optional(),
  overrides: z
    .object({
      language: z.enum(INBOUND_LANGUAGES).nullable().optional(),
      businessStatus: z.enum(BUSINESS_STATUSES).nullable().optional(),
      caseType: z.enum(INBOUND_CASE_TYPES).nullable().optional(),
      enableAllActions: z.boolean().optional(),
      transferOutcome: z.enum(['connected', 'no_answer']).optional(),
      contractOutcome: z.enum(['success', 'fail']).optional(),
      agreementStatus: z.enum(['sent', 'viewed', 'signed', 'declined']).optional(),
    })
    .default({}),
});
export type SimulateRequest = z.infer<typeof simulateRequestSchema>;

/** Turn on every action with placeholder destinations so the full flow can be exercised safely. */
function withAllActions(cfg: InboundConfig): InboundConfig {
  return inboundConfigSchema.parse({
    ...cfg,
    flags: { ...cfg.flags, human_transfer_enabled: true, contracts_enabled: true, sms_enabled: true },
    routing: {
      ...cfg.routing,
      primary_transfer_number: cfg.routing.primary_transfer_number || '+15550000001',
      backup_transfer_number: cfg.routing.backup_transfer_number || '+15550000002',
      existing_client_transfer_number: cfg.routing.existing_client_transfer_number || '+15550000003',
    },
    contracts: {
      ...cfg.contracts,
      provider: cfg.contracts.provider === 'none' ? 'sms_link' : cfg.contracts.provider,
      sms_link_url: cfg.contracts.sms_link_url || 'https://example.com/sign/{{intake_id}}',
      signflow_template_id_en: cfg.contracts.signflow_template_id_en ?? 1,
    },
  });
}

async function chatCompletion(messages: Array<Record<string, unknown>>, provider: VoiceProvider) {
  const openai = provider === 'openai';
  const res = await fetch(openai ? 'https://api.openai.com/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openai ? config.OPENAI_API_KEY : config.XAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: openai ? config.OPENAI_TEXT_MODEL : config.XAI_INBOUND_SIM_MODEL,
      temperature: 0.4,
      messages,
      tools: getInboundChatToolDefinitions(),
      tool_choice: 'auto',
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`${openai ? 'OpenAI' : 'xAI'} responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatMessage['tool_calls'] } }> };
  return json.choices?.[0]?.message ?? { content: '' };
}

export async function runSimulationTurn(req: SimulateRequest) {
  const settings = await loadLineSettings(req.lineId, true);
  const cfg = req.overrides.enableAllActions ? withAllActions(settings.config) : settings.config;
  const outcome = req.overrides.transferOutcome ?? 'connected';
  const provider: VoiceProvider =
    settings.config.routing.voice_provider === 'openai' && config.OPENAI_API_KEY.trim() ? 'openai' : 'xai';
  const { runtime, log } = createMemoryRuntime({
    config: cfg,
    instructions: settings.instructions,
    businessOverride: req.overrides.businessStatus ?? null,
    transferOutcomes: [outcome, outcome, outcome],
    contractOutcome: req.overrides.contractOutcome ?? 'success',
    agreementStatus: req.overrides.agreementStatus ?? 'signed',
  });

  let state: InboundIntakeState;
  if (req.state && Object.keys(req.state).length > 0) {
    state = req.state as unknown as InboundIntakeState;
  } else {
    state = newIntakeState({
      intakeId: 'simulation',
      callId: 'simulation',
      callerIdNumber: '(512) 555-0199',
      language: req.overrides.language ?? 'en',
    });
    if (req.overrides.caseType) {
      state.facts = { caller_type: 'new_potential_client', case_type: req.overrides.caseType };
    }
  }

  const history: ChatMessage[] = [...req.messages];
  const toolCalls: Array<{ name: string; args: unknown; ok: boolean; output: unknown }> = [];
  let reply = '';

  if (history.length === 0 && !req.userMessage.trim()) {
    reply = buildInboundGreeting({ instructions: runtime.instructions, state });
    history.push({ role: 'assistant', content: reply });
  } else {
    if (req.userMessage.trim()) history.push({ role: 'user', content: req.userMessage.trim() });

    for (let round = 0; round < 8; round += 1) {
      const business = businessStatusFor(runtime);
      const system = `${buildInboundInstructions({ instructions: runtime.instructions, config: cfg, state, business, now: runtime.now() })}\n\n# Simulation\nThis is a text simulation of a phone call. Reply with exactly what you would say out loud, nothing else.`;
      const msg = await chatCompletion([{ role: 'system', content: system }, ...history], provider);

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        history.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
        for (const call of msg.tool_calls) {
          let args: unknown = {};
          try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {
            args = { __invalid_json: call.function.arguments };
          }
          const result = await executeInboundTool(call.function.name, args, state, runtime);
          toolCalls.push({ name: call.function.name, args, ok: result.ok, output: result.output });
          history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result.output) });
        }
        continue;
      }

      reply = msg.content ?? '';
      history.push({ role: 'assistant', content: reply });
      break;
    }
  }

  const guardrails = checkAgentUtterance(reply);
  for (const v of guardrails) log.audit.push({ type: 'GUARDRAIL_FLAGGED', actor: 'SYSTEM', data: { ...v }, at: new Date().toISOString() });

  const actions = availableActionsFor(state, runtime);
  return {
    reply,
    messages: history,
    state,
    toolCalls,
    guardrails,
    audit: log.audit,
    sideEffects: { sms: log.sms, transfers: log.transfers, contracts: log.contracts },
    line: settings.line.id ? { id: settings.line.id, name: settings.line.name } : null,
    business: businessStatusFor(runtime),
    actions,
    stage: currentIntakeStage(state.facts, runtime.now()),
    missing: getMissingFields(state.facts, runtime.now()),
    summary: formatIntakeSummary(state),
  };
}
