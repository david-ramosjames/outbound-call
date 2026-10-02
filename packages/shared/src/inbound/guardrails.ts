/**
 * Post-hoc checks on what the agent actually said. The prompt is the first line of
 * defense; this catches slips so they are flagged in the audit log for staff review.
 */

export const GUARDRAIL_CATEGORIES = [
  'case_acceptance',
  'representation',
  'case_value',
  'outcome_guarantee',
  'attorney_review',
  'legal_advice',
  'medical_advice',
  'internal_criteria',
] as const;
export type GuardrailCategory = (typeof GUARDRAIL_CATEGORIES)[number];

export interface GuardrailViolation {
  category: GuardrailCategory;
  match: string;
}

const PATTERNS: Array<{ category: GuardrailCategory; re: RegExp }> = [
  // Acceptance / representation
  { category: 'case_acceptance', re: /\b(we|the firm)('ll| will| can| are going to) (definitely )?(take|accept|handle) (your|this|the) case\b/i },
  { category: 'case_acceptance', re: /\byour case (has been|is) (accepted|approved)\b/i },
  { category: 'case_acceptance', re: /\b(aceptamos|vamos a tomar|tomaremos) su caso\b/i },
  { category: 'representation', re: /\byou('re| are) (now )?(our|a) client\b/i },
  { category: 'representation', re: /\b(we|the firm) (now )?represents? you\b/i },
  { category: 'representation', re: /\b(ya )?es (nuestro|nuestra) cliente\b/i },
  { category: 'representation', re: /\b(lo|la) representamos\b/i },

  // Value / guarantees
  { category: 'case_value', re: /\byour case is worth\b/i },
  { category: 'case_value', re: /\b(worth|get|receive|recover) (about |around |at least |up to )?\$\s?\d/i },
  { category: 'case_value', re: /\bsu caso vale\b/i },
  { category: 'outcome_guarantee', re: /\byou('ll| will) (definitely |certainly )?(win|get (paid|money|compensation|a settlement))\b/i },
  { category: 'outcome_guarantee', re: /\b(i|we) (can )?guarantee\b/i },
  { category: 'outcome_guarantee', re: /\b(le )?garantizo\b|\bva a ganar\b/i },

  // Attorney review
  { category: 'attorney_review', re: /\b(an |the |our )?attorney (has|already) (reviewed|looked at|approved)\b/i },
  { category: 'attorney_review', re: /\bun abogado (ya )?(revis[oó]|aprob[oó])\b/i },

  // Advice
  { category: 'legal_advice', re: /\b(don'?t|do not|never) (talk|speak|give (a )?(recorded )?statement) to (the )?(insurance|adjuster|insurer)/i },
  { category: 'legal_advice', re: /\byou (should|need to|must) (sue|file a lawsuit|reject (the|their) offer|accept (the|their) offer)\b/i },
  { category: 'legal_advice', re: /\bno (hable|dé una declaración) (con|a) (el |la )?(seguro|ajustador)/i },
  { category: 'medical_advice', re: /\b(stop|skip|delay|avoid|don'?t (go to|see)) (your |the )?(doctor|treatment|therapy|physical therapy)\b/i },

  // Internal criteria
  { category: 'internal_criteria', re: /\b(qualification|scoring) (rule|criteria|score)s?\b/i },
  { category: 'internal_criteria', re: /\b(you|your case) (scored|didn'?t qualify because|failed (our|the) criteria)\b/i },
];

export function checkAgentUtterance(text: string): GuardrailViolation[] {
  if (!text) return [];
  const out: GuardrailViolation[] = [];
  for (const { category, re } of PATTERNS) {
    const m = text.match(re);
    if (m && !out.some((v) => v.category === category)) out.push({ category, match: m[0] });
  }
  return out;
}
