export type CaptureValidation =
  | { ok: true; value: string }
  | { ok: false; problem: string };

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

function spokenDigitsToNumerals(input: string): string {
  return input.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi, (w) =>
    DIGIT_WORDS[w.toLowerCase()] ?? w,
  );
}

export function captureKind(fieldKey: string): 'phone' | 'email' | 'claim_number' | 'text' {
  const key = fieldKey.toLowerCase();
  if (key.includes('email')) return 'email';
  if (key.includes('phone') || key.includes('fax')) return 'phone';
  if (key === 'claim_number' || key.endsWith('_claim_number')) return 'claim_number';
  return 'text';
}

export function normalizePhoneCapture(raw: string): CaptureValidation {
  const converted = spokenDigitsToNumerals(raw);
  const [main = '', ext] = converted.split(/\b(?:ext\.?|extension|x)\s*/i);
  let digits = main.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);

  if (digits.length !== 10) {
    return {
      ok: false,
      problem: `Expected a 10-digit phone/fax number but heard ${digits.length} digits.`,
    };
  }

  const extDigits = ext?.replace(/\D/g, '') ?? '';
  const formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return { ok: true, value: extDigits ? `${formatted} ext. ${extDigits}` : formatted };
}

const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export function normalizeEmailCapture(raw: string): CaptureValidation {
  const value = raw
    .toLowerCase()
    .replace(/\s+at\s+/g, '@')
    .replace(/\s+dot\s+/g, '.')
    .replace(/\bunderscore\b/g, '_')
    .replace(/\b(dash|hyphen)\b/g, '-')
    .replace(/\s+/g, '');

  if (!EMAIL_REGEX.test(value)) {
    return {
      ok: false,
      problem: `"${value}" is not a complete email address (need name@domain.com).`,
    };
  }
  return { ok: true, value };
}

export function normalizeClaimNumberCapture(raw: string): CaptureValidation {
  const value = spokenDigitsToNumerals(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');

  const alnum = value.replace(/-/g, '');
  if (alnum.length < 5 || !/\d/.test(alnum)) {
    return {
      ok: false,
      problem: `"${value}" is too short or has no digits to be a claim number.`,
    };
  }
  return { ok: true, value };
}

/** Normalize a value heard on the call; reject values that clearly cannot be right. */
export function validateCapturedField(fieldKey: string, raw: string): CaptureValidation {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, problem: 'Value is empty.' };

  switch (captureKind(fieldKey)) {
    case 'phone':
      return normalizePhoneCapture(trimmed);
    case 'email':
      return normalizeEmailCapture(trimmed);
    case 'claim_number':
      return normalizeClaimNumberCapture(trimmed);
    default:
      return { ok: true, value: trimmed };
  }
}
