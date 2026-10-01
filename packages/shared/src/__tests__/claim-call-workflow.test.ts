import { describe, it, expect } from 'vitest';
import {
  validateCapturedField,
  resolveOutcomeReason,
  isNeverDisclosedField,
  claimPartyForMissionType,
  DEFAULT_INCLUDED_FIELDS_BY_MISSION,
  WITHHELD_BY_DEFAULT_FIELDS,
  SELECTABLE_MISSION_TYPES,
} from '../index.js';

describe('validateCapturedField', () => {
  it('normalizes spoken and formatted phone numbers', () => {
    expect(validateCapturedField('adjuster_phone', '512.555.0100')).toEqual({
      ok: true,
      value: '(512) 555-0100',
    });
    expect(
      validateCapturedField('adjuster_fax', 'five one two five five five zero one zero one'),
    ).toEqual({ ok: true, value: '(512) 555-0101' });
    expect(validateCapturedField('adjuster_phone', '1-800-555-0199 ext 4321')).toEqual({
      ok: true,
      value: '(800) 555-0199 ext. 4321',
    });
  });

  it('rejects phone numbers with the wrong digit count', () => {
    expect(validateCapturedField('adjuster_phone', '555-0100').ok).toBe(false);
  });

  it('normalizes spoken emails and rejects incomplete ones', () => {
    expect(validateCapturedField('adjuster_email', 'J Smith at State Farm dot com')).toEqual({
      ok: true,
      value: 'jsmith@statefarm.com',
    });
    expect(validateCapturedField('adjuster_email', 'j underscore smith at geico dot com')).toEqual({
      ok: true,
      value: 'j_smith@geico.com',
    });
    expect(validateCapturedField('adjuster_email', 'jsmith at statefarm').ok).toBe(false);
  });

  it('normalizes claim numbers and rejects implausible ones', () => {
    expect(validateCapturedField('claim_number', '53-60m2 24j')).toEqual({
      ok: true,
      value: '53-60M224J',
    });
    expect(validateCapturedField('claim_number', 'eight eight nine six five')).toEqual({
      ok: true,
      value: '88965',
    });
    expect(validateCapturedField('claim_number', 'ABC').ok).toBe(false);
  });

  it('passes free text through trimmed', () => {
    expect(validateCapturedField('adjuster_name', '  Jane Smith ')).toEqual({
      ok: true,
      value: 'Jane Smith',
    });
  });
});

describe('resolveOutcomeReason', () => {
  const base = {
    reported: null,
    escalated: false,
    reachedHuman: true,
    hasClaim: true,
    missingRequiredCount: 0,
  };

  it('downgrades a reported "completed" when required outputs are missing', () => {
    expect(
      resolveOutcomeReason({ ...base, reported: 'completed', missingRequiredCount: 2 }),
    ).toBe('missing_required_information');
  });

  it('keeps a reported carrier refusal', () => {
    expect(resolveOutcomeReason({ ...base, reported: 'carrier_refused_ai', hasClaim: false })).toBe(
      'carrier_refused_ai',
    );
  });

  it('infers unable to reach when no human spoke', () => {
    expect(resolveOutcomeReason({ ...base, reachedHuman: false, hasClaim: false })).toBe(
      'unable_to_reach_representative',
    );
  });

  it('infers completed only when every required output is present', () => {
    expect(resolveOutcomeReason(base)).toBe('completed');
    expect(resolveOutcomeReason({ ...base, missingRequiredCount: 1 })).toBe(
      'missing_required_information',
    );
  });
});

describe('minimum disclosure defaults', () => {
  it('never pre-selects DOB, client phone, or client address', () => {
    for (const type of SELECTABLE_MISSION_TYPES) {
      for (const field of WITHHELD_BY_DEFAULT_FIELDS) {
        expect(DEFAULT_INCLUDED_FIELDS_BY_MISSION[type]).not.toContain(field);
      }
    }
  });

  it('treats SSN and driver license fields as never disclosed', () => {
    expect(isNeverDisclosedField('social_security_number')).toBe(true);
    expect(isNeverDisclosedField('client_ssn')).toBe(true);
    expect(isNeverDisclosedField('drivers_license_number')).toBe(true);
    expect(isNeverDisclosedField('business_name')).toBe(false);
  });
});

describe('claim party', () => {
  it('maps the open-claim types to first or third party', () => {
    expect(claimPartyForMissionType('open_claim_first_party')).toBe('first_party');
    expect(claimPartyForMissionType('open_claim_third_party')).toBe('third_party');
    expect(claimPartyForMissionType('follow_up_existing_claim')).toBeNull();
    expect(SELECTABLE_MISSION_TYPES).not.toContain('open_insurance_claim');
  });
});
