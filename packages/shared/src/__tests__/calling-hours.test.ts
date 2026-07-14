import { describe, it, expect } from 'vitest';
import { isWithinCallingHours } from '../utils/calling-hours';

describe('isWithinCallingHours', () => {
  it('returns false for invalid timezone', () => {
    expect(isWithinCallingHours('Invalid/Timezone', '09:00', '17:00')).toBe(false);
  });

  it('handles valid timezone check', () => {
    const result = isWithinCallingHours('America/Chicago', '00:00', '23:59');
    expect(result).toBe(true);
  });

  it('returns false when outside hours', () => {
    const result = isWithinCallingHours('America/Chicago', '25:00', '25:01');
    expect(result).toBe(false);
  });
});
