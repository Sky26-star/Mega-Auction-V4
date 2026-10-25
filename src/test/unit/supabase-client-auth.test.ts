import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserClient } from '@supabase/ssr';
import { createClient, setClerkTokenGetter } from '@/lib/supabase/client';

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(),
}));

vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'test-anon-key',
  }),
}));

describe('Supabase browser client auth failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setClerkTokenGetter(null);
    vi.mocked(createBrowserClient).mockReturnValue({} as any);
  });

  it('required authentication rejects token-provider failures without exposing provider details', async () => {
    const tokenProvider = vi.fn().mockRejectedValue(
      new Error('private JWT and signing detail')
    );

    createClient(tokenProvider, { requireAuth: true });
    const options = vi.mocked(createBrowserClient).mock.calls[0]?.[2] as any;

    await expect(options.accessToken()).rejects.toThrow(
      'Failed to retrieve Supabase authentication token.'
    );
    expect(tokenProvider).toHaveBeenCalledTimes(1);
  });

  it('required authentication rejects a missing token provider instead of using anon access', async () => {
    createClient(undefined, { requireAuth: true });
    const options = vi.mocked(createBrowserClient).mock.calls[0]?.[2] as any;

    await expect(options.accessToken()).rejects.toThrow(
      'Supabase authentication token provider is not initialized.'
    );
  });
});
