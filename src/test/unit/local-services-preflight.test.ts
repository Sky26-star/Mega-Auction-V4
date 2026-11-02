import { describe, expect, it, vi } from 'vitest';

const { checkLocalSupabase } = require('../../../scripts/check-local-services.js');
const env = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-public-key',
};

describe('local development service preflight', () => {
  it('uses a read-only health request and never sends the service-role credential', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await checkLocalSupabase({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: 'private-service-key' }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:55321/auth/v1/health', expect.objectContaining({
      method: 'GET', headers: { apikey: 'test-public-key' }, redirect: 'manual', cache: 'no-store',
    }));
  });

  it('reports an unavailable local dependency without exposing raw network errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('request failed: private-service-key'));
    await expect(checkLocalSupabase({ env, fetchImpl })).rejects.toThrow('Local Supabase is unavailable at http://127.0.0.1:55321. Start Docker Desktop');
    await expect(checkLocalSupabase({ env, fetchImpl })).rejects.not.toThrow('private-service-key');
  });

  it('fails on HTTP errors and redirects instead of treating a listening port as ready', async () => {
    for (const status of [301, 401, 503]) {
      const fetchImpl = vi.fn(async () => new Response(null, { status }));
      await expect(checkLocalSupabase({ env, fetchImpl })).rejects.toThrow(`returned HTTP ${status}`);
    }
  });

  it('bounds the health request when the service does not respond', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    await expect(checkLocalSupabase({ env, fetchImpl, timeoutMs: 5 })).rejects.toThrow('Local Supabase is unavailable');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('skips hosted projects without making a request', async () => {
    const fetchImpl = vi.fn();
    await checkLocalSupabase({ env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires a local public key and rejects credential-bearing URLs without making a request', async () => {
    const fetchImpl = vi.fn();
    await expect(checkLocalSupabase({ env: { NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL }, fetchImpl })).rejects.toThrow('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    await expect(checkLocalSupabase({ env: { ...env, NEXT_PUBLIC_SUPABASE_URL: 'http://user:private-service-key@localhost:55321' }, fetchImpl })).rejects.toThrow('without credentials');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
