import { describe, expect, it } from 'vitest';

import { normalizeId } from './robloxProfiles';

describe('normalizeId', () => {
  it('converts a number to a trimmed string', () => {
    expect(normalizeId(12345)).toBe('12345');
  });

  it('trims whitespace from string ids', () => {
    expect(normalizeId('  987654  ')).toBe('987654');
  });

  it('returns empty string for null', () => {
    expect(normalizeId(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeId(undefined)).toBe('');
  });

  it('preserves a valid string id unchanged', () => {
    expect(normalizeId('7654321')).toBe('7654321');
  });
});
