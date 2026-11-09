import { describe, expect, it } from 'vitest';
import { safeAuthRedirect } from '@/lib/auth/redirect';

describe('native auth callback destinations', () => {
  it('disables recovery destinations and defaults to profile validation', () => {
    expect(safeAuthRedirect('/reset-password')).toBe('/auth/complete');
    expect(safeAuthRedirect(null)).toBe('/auth/complete');
  });
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/%5c%5cevil.example', '/dashboard?next=//evil.example', '/\n/evil.example'])(
    'rejects an unapproved callback %s', value => expect(safeAuthRedirect(value)).toBe('/auth/complete'),
  );
});
