// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: vi.fn(), getUser: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.client }));
vi.mock('@/lib/env', () => ({ getEnv: () => ({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'public' }) }));
import { updateSession } from '@/lib/supabase/middleware';

describe('social sign-in protected routes and cookie refresh', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.client.mockReturnValue({ auth: { getUser: mocks.getUser } }); mocks.getUser.mockResolvedValue({ data: { user: null }, error: null }); });
  it.each(['/dashboard', '/profile', '/rooms', '/rooms/room-id'])('redirects signed-out access to %s', async path => {
    const r = await updateSession(new NextRequest('https://auction.example' + path));
    expect(r.status).toBe(307); expect(r.headers.get('location')).toBe('https://auction.example/sign-in');
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });
  it('allows an Auth-verified UUID and returns refreshed cookies', async () => {
    const request = new NextRequest('https://auction.example/rooms/room-id', { headers: { cookie: 'sb-test-auth-token=old' } });
    mocks.getUser.mockImplementation(async () => {
      mocks.client.mock.calls[0]![2].cookies.setAll([{ name: 'sb-test-auth-token', value: 'refreshed', options: { path: '/', sameSite: 'lax' } }]);
      return { data: { user: { id: 'verified-uuid' } }, error: null };
    });
    const r = await updateSession(request); expect(r.status).toBe(200);
    expect(r.cookies.get('sb-test-auth-token')?.value).toBe('refreshed');
    expect(request.cookies.get('sb-test-auth-token')?.value).toBe('refreshed');
  });
  it('does not call Auth for a public OAuth entry page without cookies', async () => {
    const r = await updateSession(new NextRequest('https://auction.example/sign-in'));
    expect(r.status).toBe(200); expect(mocks.client).not.toHaveBeenCalled();
  });
});
