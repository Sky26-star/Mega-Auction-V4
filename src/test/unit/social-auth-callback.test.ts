// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
import { GET } from '@/app/auth/callback/route';

describe('social OAuth callback', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.client.mockResolvedValue({ auth: { exchangeCodeForSession: mocks.exchange } }); mocks.exchange.mockResolvedValue({ error: null }); });
  it.each(['google', 'github'])('exchanges a %s authorization code using existing SSR session infrastructure', async provider => {
    const r = await GET(new Request(`https://auction.example/auth/callback?code=${provider}-code`));
    expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith(`${provider}-code`);
    expect(r.headers.get('location')).toBe('https://auction.example/auth/complete');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/reset-password'])('blocks callback destination %s', async destination => {
    const r = await GET(new Request('https://auction.example/auth/callback?code=test&next=' + encodeURIComponent(destination)));
    expect(r.headers.get('location')).toBe('https://auction.example/auth/complete');
  });
  it('handles cancellation before code exchange and does not reflect provider descriptions', async () => {
    const r = await GET(new Request('https://auction.example/auth/callback?error=access_denied&error_description=private&code=ignored'));
    expect(r.headers.get('location')).toBe('https://auction.example/sign-in?error=oauth_cancelled');
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('handles missing codes without querying Auth', async () => {
    const r = await GET(new Request('https://auction.example/auth/callback'));
    expect(r.headers.get('location')).toContain('error=invalid_callback'); expect(mocks.client).not.toHaveBeenCalled();
  });
  it('handles provider error codes safely', async () => {
    const r = await GET(new Request('https://auction.example/auth/callback?error_code=server_error&error_description=private'));
    expect(r.headers.get('location')).toBe('https://auction.example/sign-in?error=oauth_failed');
  });
  it('rejects invalid/expired/replayed codes', async () => {
    mocks.exchange.mockResolvedValue({ error: new Error('private') });
    const r = await GET(new Request('https://auction.example/auth/callback?code=expired'));
    expect(r.headers.get('location')).toContain('error=invalid_callback');
  });
  it('handles Auth network failures without exposing details', async () => {
    mocks.exchange.mockRejectedValue(new Error('private'));
    const r = await GET(new Request('https://auction.example/auth/callback?code=test'));
    expect(r.headers.get('location')).toBe('https://auction.example/sign-in?error=oauth_unavailable');
  });
});
