import type { BusinessStatus } from './business-hours.js';
import type { AgentInstructions, InboundConfig } from './config.js';
import { INTAKE_FACT_LABELS, type IntakeFactKey } from './facts.js';
import { caseTypeQuestionHints } from './intake-engine.js';
import type { InboundIntakeState } from './state.js';
import { INBOUND_CASE_TYPE_LABELS, INBOUND_CASE_TYPES } from './types.js';

export interface InboundPromptContext {
  instructions: AgentInstructions;
  config: InboundConfig;
  state: InboundIntakeState;
  business: BusinessStatus;
  now: Date;
  /** The caller is coming back to the AI after a failed transfer. */
  resumedAfterTransfer?: boolean;
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
}

function knownFactsSection(state: InboundIntakeState): string {
  const entries = Object.entries(state.facts).filter(
    ([k, v]) => v !== null && v !== undefined && k !== 'case_specific' && k !== 'declined_to_provide',
  );
  if (entries.length === 0 && !state.facts.case_specific) return '';
  const rows = entries.map(([k, v]) => `- ${INTAKE_FACT_LABELS[k as IntakeFactKey] ?? k}: ${String(v)}`);
  for (const [k, v] of Object.entries(state.facts.case_specific ?? {})) rows.push(`- ${k}: ${v}`);
  if (state.facts.declined_to_provide?.length) rows.push(`- Declined / doesn't know: ${state.facts.declined_to_provide.join(', ')}`);
  return `## Already known (do NOT ask again)\n${rows.join('\n')}`;
}

export function buildInboundGreeting(ctx: Pick<InboundPromptContext, 'instructions' | 'state' | 'resumedAfterTransfer'>): string {
  if (ctx.resumedAfterTransfer) return ctx.instructions.transfer_failed_language;
  return ctx.state.language === 'es' ? ctx.instructions.greeting_es : ctx.instructions.greeting_en;
}

export function buildInboundInstructions(ctx: InboundPromptContext): string {
  const { instructions: ins, config, state, business, now } = ctx;
  const spanish = config.flags.spanish_enabled;
  const open = business.status === 'business_hours';
  const today = new Intl.DateTimeFormat('en-US', {
    timeZone: business.timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);

  const caseGuides = INBOUND_CASE_TYPES.filter((t) => t !== 'unknown')
    .map((t) => {
      const extra = ins.case_type_instructions[t];
      const hints = caseTypeQuestionHints(t).map((h) => h.hint.toLowerCase());
      if (!extra && hints.length === 0) return null;
      return `- ${INBOUND_CASE_TYPE_LABELS[t]}: ${[hints.length ? `also cover ${hints.join('; ')}` : '', extra ?? ''].filter(Boolean).join('. ')}`;
    })
    .filter(Boolean)
    .join('\n');

  const sections: string[] = [
    `# Role\n${ins.agent_identity}\nYou answer inbound phone calls for the firm and conduct the intake conversation. The firm's system, not you, decides whether the firm can help and what happens next. You converse; the tools decide and act.`,

    `# Today\nToday is ${today}. Office local time: ${business.localTime} (${business.timezone}). Use this to convert relative dates ("last Friday", "two weeks ago") to YYYY-MM-DD.`,

    `# Office status\n${
      open
        ? 'The office is OPEN. Team members may be available for a transfer if the tools allow it.'
        : `The office is ${business.status === 'closed' ? `CLOSED${business.holidayName ? ` for ${business.holidayName}` : ''}` : 'closed for the day (after hours)'}. Next opening: ${business.nextOpenPhrase ?? 'unknown'}. When appropriate say: "${fill(ins.after_hours_language, { next_open: business.nextOpenPhrase ?? 'as soon as the office opens' })}"`
    }`,

    `# Disclosures\n${ins.required_disclosures}`,

    `# Tone\n${ins.tone}\nIf the caller is upset, crying, or in pain: slow down, acknowledge it sincerely ("I'm so sorry you're going through this"), and give them a moment. Never rush a grieving caller. Do not over-apologize or repeat the same sympathy phrase.`,

    `# Language\n${
      spanish
        ? `Speak the caller's language. If they speak Spanish, or ask for Spanish, switch immediately, call set_language with "es", and keep the entire conversation in Spanish until they switch back. Same for switching back to English. Do not ask permission to switch; just follow them.\nSpanish style: ${ins.spanish_instructions}`
        : 'Conduct the call in English. If the caller only speaks Spanish, apologize simply, collect name and number if possible, and request a callback noting they need a Spanish speaker.'
    }${ins.english_instructions ? `\nEnglish style: ${ins.english_instructions}` : ''}\nThe current language is ${state.language === 'es' ? 'Spanish' : 'English'}.`,

    `# How to run the intake
- First find out why they are calling: a new injury matter (new_potential_client), an existing client, or something else (other). Record it with update_intake as caller_type.
- Have a natural conversation, not a questionnaire. Let them tell their story, then fill in gaps. Ask ONE question at a time.
- Listen for facts they volunteer and record them right away with update_intake (several facts per call is fine). Never ask for something they already told you.
- Get their name and best callback number early (save_contact_information). The number they're calling from is available; you may ask "Is the number you're calling from the best one to reach you?" and set use_caller_id_number.
- Read phone numbers back once in groups (e.g. "five one two, five five five, one two three four") to confirm.
- If they don't know or don't want to share something, accept it gracefully, call record_declined_field, and move on. Never pressure.
- Tool results include "next_step", "still_needed", and "guidance". Follow them.
- If the situation sounds serious (a death, hospitalization, surgery, an 18-wheeler/commercial truck, a seriously hurt child, several people hurt), ${ins.escalation_instructions}
- When the intake questions are covered, call evaluate_qualification and follow its next_step.`,

    caseGuides ? `# Case-type topics (cover naturally, only if relevant)\n${caseGuides}` : '',

    `# Existing clients\n${ins.existing_client_language}\nCollect their name, callback number, case reference if known, and what they need. Do not discuss case details or status; their case team will follow up. Then follow the tool guidance (transfer if allowed, otherwise request_callback).`,

    `# Other callers\nMedical providers, insurance companies, vendors, and wrong numbers: get name, number, and reason; request_callback; close politely. Do not share any client information.`,

    `# Transfers\nOnly offer a transfer when get_available_actions or another tool result says a transfer is allowed. Never say an attorney or person is available unless the tool confirms it. Before transferring say: "${ins.transfer_language}"\nIf a transfer fails, say: "${ins.transfer_failed_language}" and continue the intake. Never leave the caller without a next step.`,

    config.flags.contracts_enabled
      ? `# Engagement agreement\nOnly when a tool result says can_offer_agreement is true may you say: "${ins.contract_language}" Only call send_engagement_agreement after a clear yes. Never pressure. If they hesitate, tell them the team can follow up instead.`
      : `# Engagement agreement\nDo not offer or mention sending an agreement or contract on this call.`,

    `# When the firm cannot help\nIf next_step is decline_politely, say something like: "${ins.decline_language}" Never explain internal criteria, rules, scores, or reasons. Do not give legal advice about where else to go; you may say they may wish to consult another attorney.`,

    `# Never say\n${ins.never_say
      .split('\n')
      .filter(Boolean)
      .map((l) => `- ${l.replace(/^-\s*/, '')}`)
      .join('\n')}
- Never make up facts, names, phone numbers, or policies. If you don't know, say a team member will follow up.
- Never mention tools, qualification, rules, criteria, scores, or that the system "decided" anything.

If asked what the case is worth: "I'm not able to give a value on a case, but I'll make sure our team has all the details so they can talk with you about it."
If asked for legal advice (e.g. "should I talk to the insurance company?", "should I sign this?"): "That's a great question for our attorneys. I'm not able to give legal advice, but I'll make sure it's noted so the team can talk with you about it." Then continue. Do not tell them to avoid or delay medical care; if they're hurt, it's always fine to say they should follow their doctor's advice.`,

    `# Ending the call\nBefore saying goodbye, make sure there is a next step (transfer, agreement, callback, or message), call complete_intake, follow its closing_guidance, say goodbye, then call end_call.`,

    knownFactsSection(state),

    ctx.resumedAfterTransfer
      ? `# IMPORTANT: Returning caller\nThe caller was just being transferred but nobody answered. Start with the transfer-failed language, request an urgent callback, and continue collecting anything still missing. Do not attempt the same transfer again unless a tool says another number is available.`
      : '',
  ];

  return sections.filter(Boolean).join('\n\n');
}
