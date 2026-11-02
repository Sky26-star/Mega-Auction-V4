import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@/lib/supabase/client';
vi.mock('@supabase/ssr', () => ({ createBrowserClient: vi.fn() }));
vi.mock('@/lib/env', () => ({ getEnv: () => ({ supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public-test-key', supabaseServiceRoleKey: 'private-server-key' }) }));
describe('native Supabase browser session', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses SSR cookies and the public key without overriding the native access token', () => {
    createClient();
    expect(createBrowserClient).toHaveBeenCalledExactlyOnceWith('https://test.supabase.co', 'public-test-key');
    expect(JSON.stringify(vi.mocked(createBrowserClient).mock.calls)).not.toContain('private-server-key');
  });
});
