import type { QualificationConfig, QualificationRule, RuleCondition, RuleField } from './config.js';
import type { IntakeFacts } from './facts.js';
import {
  detectUrgentIndicators,
  incidentAgeDays,
  injuryReported,
  injurySeverityRank,
  normalizeStateCode,
  type UrgentIndicator,
} from './intake-engine.js';
import type { QualificationResultValue } from './types.js';

export interface QualificationOutcome {
  result: QualificationResultValue;
  /** Human-readable reasons, for staff only. */
  reasons: string[];
  matchedRuleIds: string[];
  canSendContract: boolean;
  contractBlockedBy: string[];
  urgentIndicators: UrgentIndicator[];
  riskFlags: string[];
  evaluatedAt: string;
}

export function deriveRuleValue(field: RuleField, facts: IntakeFacts, now: Date): unknown {
  switch (field) {
    case 'incident_age_days':
      return incidentAgeDays(facts, now);
    case 'injury_severity_rank':
      return injurySeverityRank(facts);
    case 'injury_reported':
      return injuryReported(facts);
    case 'incident_state':
      return normalizeStateCode(facts.incident_state ?? null);
    case 'any_urgent_indicator':
      return detectUrgentIndicators(facts, now).length > 0;
    default:
      return (facts as Record<string, unknown>)[field] ?? null;
  }
}

function isSet(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

export function conditionMatches(cond: RuleCondition, facts: IntakeFacts, now: Date): boolean {
  const actual = deriveRuleValue(cond.field, facts, now);
  const expected = cond.value;
  const norm = (v: unknown) =>
    cond.field === 'incident_state' && typeof v === 'string' ? normalizeStateCode(v) : v;

  switch (cond.op) {
    case 'is_set':
      return isSet(actual);
    case 'is_not_set':
      return !isSet(actual);
    case 'is_true':
      return actual === true;
    case 'is_false':
      return actual === false;
    case 'eq':
      return isSet(actual) && norm(actual) === norm(expected);
    case 'neq':
      return isSet(actual) && norm(actual) !== norm(expected);
    case 'in':
      return isSet(actual) && Array.isArray(expected) && expected.map(norm).includes(norm(actual));
    case 'not_in':
      return isSet(actual) && Array.isArray(expected) && !expected.map(norm).includes(norm(actual));
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
  }
}

export function ruleMatches(rule: QualificationRule, facts: IntakeFacts, now: Date): boolean {
  return rule.enabled && rule.conditions.every((c) => conditionMatches(c, facts, now));
}

/**
 * Apply the firm's configured rules to the extracted facts. The model never decides this.
 *
 * Precedence when several rules match:
 *   not_qualified  >  high_priority  >  needs_review  >  qualified
 * A high-priority case that also needs review stays high priority (with the review reasons kept),
 * so a serious case is never buried in a review queue.
 */
export function evaluateQualification(
  facts: IntakeFacts,
  config: QualificationConfig,
  now: Date = new Date(),
): QualificationOutcome {
  const matched = config.rules.filter((r) => ruleMatches(r, facts, now));
  const byResult = (r: QualificationResultValue) => matched.filter((m) => m.result === r);

  const notQualified = byResult('not_qualified');
  const high = byResult('high_priority');
  const review = byResult('needs_review');
  const qualified = byResult('qualified');

  let result: QualificationResultValue;
  let deciding: QualificationRule[];
  if (notQualified.length > 0) {
    result = 'not_qualified';
    deciding = notQualified;
  } else if (high.length > 0) {
    result = 'high_priority';
    deciding = [...high, ...review];
  } else if (review.length > 0) {
    result = 'needs_review';
    deciding = review;
  } else if (qualified.length > 0) {
    result = 'qualified';
    deciding = qualified;
  } else {
    result = config.default_result;
    deciding = [];
  }

  const reasons = deciding.map((r) => r.reason);
  if (deciding.length === 0) reasons.push('No qualification rule matched the facts collected so far');
  if (result === 'qualified' || result === 'high_priority') {
    for (const r of qualified) if (!reasons.includes(r.reason)) reasons.push(r.reason);
  }

  const contractBlockedBy = matched.filter((r) => r.blocks_contract).map((r) => r.name);
  const missingContact = !facts.caller_name || !facts.phone;
  const canSendContract =
    (result === 'qualified' || result === 'high_priority') &&
    matched.some((r) => r.can_send_contract && (r.result === 'qualified' || r.result === 'high_priority')) &&
    contractBlockedBy.length === 0 &&
    !missingContact;

  const urgentIndicators = detectUrgentIndicators(facts, now);
  const riskFlags = [
    ...review.map((r) => r.reason),
    ...(facts.declined_to_provide?.length ? [`Caller declined to provide: ${facts.declined_to_provide.join(', ')}`] : []),
  ];

  return {
    result,
    reasons,
    matchedRuleIds: matched.map((r) => r.id),
    canSendContract,
    contractBlockedBy,
    urgentIndicators,
    riskFlags,
    evaluatedAt: now.toISOString(),
  };
}
