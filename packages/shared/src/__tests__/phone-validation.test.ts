import { describe, it, expect } from 'vitest';
import { isValidE164, isValidUSPhone, normalizePhoneNumber } from '../utils/phone-validation';

describe('isValidE164', () => {
  it('accepts valid E.164 numbers', () => {
    expect(isValidE164('+15551234567')).toBe(true);
    expect(isValidE164('+442071234567')).toBe(true);
    expect(isValidE164('+1234')).toBe(true);
  });

  it('rejects invalid numbers', () => {
    expect(isValidE164('5551234567')).toBe(false);
    expect(isValidE164('+0123')).toBe(false);
    expect(isValidE164('')).toBe(false);
    expect(isValidE164('abc')).toBe(false);
  });
});

describe('isValidUSPhone', () => {
  it('accepts valid US numbers', () => {
    expect(isValidUSPhone('+15551234567')).toBe(true);
    expect(isValidUSPhone('+12125551234')).toBe(true);
  });

  it('rejects invalid US numbers', () => {
    expect(isValidUSPhone('+10551234567')).toBe(false);
    expect(isValidUSPhone('+442071234567')).toBe(false);
    expect(isValidUSPhone('+1555123')).toBe(false);
  });
});

describe('normalizePhoneNumber', () => {
  it('normalizes 10-digit numbers', () => {
    expect(normalizePhoneNumber('5551234567')).toBe('+15551234567');
  });

  it('normalizes 11-digit numbers starting with 1', () => {
    expect(normalizePhoneNumber('15551234567')).toBe('+15551234567');
  });

  it('preserves existing +prefix', () => {
    expect(normalizePhoneNumber('+15551234567')).toBe('+15551234567');
  });

  it('strips non-digit characters', () => {
    expect(normalizePhoneNumber('(555) 123-4567')).toBe('+15551234567');
    expect(normalizePhoneNumber('555.123.4567')).toBe('+15551234567');
  });
});
