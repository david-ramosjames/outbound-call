import { z } from 'zod';

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const US_PHONE_REGEX = /^\+1[2-9]\d{9}$/;

export function isValidE164(phone: string): boolean {
  return E164_REGEX.test(phone);
}

export function isValidUSPhone(phone: string): boolean {
  return US_PHONE_REGEX.test(phone);
}

export function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  if (phone.startsWith('+')) {
    return phone;
  }
  return `+${digits}`;
}

export const phoneNumberSchema = z.string().transform(normalizePhoneNumber).pipe(
  z.string().regex(E164_REGEX, 'Must be a valid E.164 phone number')
);
