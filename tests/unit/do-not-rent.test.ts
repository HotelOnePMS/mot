import { describe, expect, it } from 'vitest';
import { emailKey, phoneKey } from '@/lib/doNotRent';

describe('Do Not Rent matching keys', () => {
  it('matches phones written differently', () => {
    expect(phoneKey('+1 (555) 010-2030')).toBe('5550102030');
    expect(phoneKey('555.010.2030')).toBe('5550102030');
    expect(phoneKey('12')).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });

  it('ignores case and spaces in emails', () => {
    expect(emailKey('  Rex@Example.ORG ')).toBe('rex@example.org');
    expect(emailKey('not an email')).toBeNull();
  });
});
