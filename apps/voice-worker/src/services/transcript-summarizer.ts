import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const SummarySchema = z.object({
  summary: z.string(),
  extractedFields: z
    .object({
      claim_number: z.string().nullable().optional(),
      adjuster_name: z.string().nullable().optional(),
      adjuster_phone: z.string().nullable().optional(),
      adjuster_email: z.string().nullable().optional(),
      carrier_fax: z.string().nullable().optional(),
      carrier_mailing_address: z.string().nullable().optional(),
      representative_name: z.string().nullable().optional(),
      representative_department: z.string().nullable().optional(),
    })
    .partial()
    .default({}),
  commitments: z.array(z.string()).default([]),
  nextAction: z.string().nullable().optional(),
});

export type TranscriptSummary = z.infer<typeof SummarySchema>;

const SYSTEM_PROMPT = `You summarize outbound phone calls placed by a personal-injury law firm's AI agent to insurance carriers.

Write a concise factual summary (3-6 sentences) of what happened on the call: who was reached, what was asked, what the carrier said, what was obtained, what was refused or unavailable, and any follow-up promised.

Strict rules:
- NEVER mention, characterize, or speculate about the client's injuries, symptoms, medical condition, treatment, prognosis, or bodily-injury status.
- NEVER include statements about fault or liability.
- If those topics came up, write only: "Carrier raised bodily-injury/liability questions; agent declined and referred them to the firm."
- Only report facts stated in the transcript. Do not invent values.

Also extract any of these values if clearly stated by the carrier representative: claim_number, adjuster_name, adjuster_phone, adjuster_email, carrier_fax, carrier_mailing_address, representative_name, representative_department. Use null when not stated.

Respond with JSON only:
{"summary": string, "extractedFields": {...}, "commitments": string[], "nextAction": string | null}`;

const SPEAKER_LABELS: Record<string, string> = {
  ai_agent: 'Agent',
  insurance_representative: 'Carrier',
};

export async function summarizeTranscript(
  missionId: string
): Promise<TranscriptSummary | null> {
  const { data: segments, error } = await supabase
    .from('call_transcript_segments')
    .select('speaker, text, sequence_number')
    .eq('call_mission_id', missionId)
    .order('sequence_number', { ascending: true });

  if (error) {
    logger.error('Failed to load transcript for summary', {
      missionId,
      errorMessage: error.message,
    });
    return null;
  }

  if (!segments || segments.length === 0) return null;

  const transcript = segments
    .map((s) => `${SPEAKER_LABELS[s.speaker] ?? s.speaker}: ${s.text}`)
    .join('\n');

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.XAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.XAI_SUMMARY_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Transcript:\n${transcript}` },
        ],
      }),
    });

    if (!res.ok) {
      logger.error('Transcript summary request failed', {
        missionId,
        status: String(res.status),
        body: (await res.text()).slice(0, 500),
      });
      return null;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = SummarySchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      logger.error('Transcript summary did not match schema', {
        missionId,
        issues: parsed.error.issues,
      });
      return null;
    }

    return parsed.data;
  } catch (err) {
    logger.error('Transcript summary failed', { missionId, error: err });
    return null;
  }
}
