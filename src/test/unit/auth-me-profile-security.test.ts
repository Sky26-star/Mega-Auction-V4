import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), createServerClient: vi.fn() }));
vi.mock('@/lib/auth/server-session', () => ({ auth: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createServerClient }));
import { GET, PUT } from '@/app/api/auth/me/route';
const profile = { id: 'verified-user-id', username: 'owner', display_name: 'Room Owner', avatar_url: null };
function client(value: unknown = profile) {
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), update: vi.fn((_value: unknown) => chain), maybeSingle: vi.fn().mockResolvedValue({ data: value, error: null }), single: vi.fn().mockResolvedValue({ data: value, error: null }) };
  return { from: vi.fn(() => chain), chain };
}
describe('native own-profile API privacy', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: profile.id }); });
  it('reads only the verified user UUID using ordinary RLS', async () => {
    const db = client(); mocks.createServerClient.mockResolvedValue(db);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(db.from).toHaveBeenCalledExactlyOnceWith('profiles');
    expect(db.chain.eq).toHaveBeenCalledWith('id', profile.id);
    expect(db.chain.select).toHaveBeenCalledWith('id, username, display_name, avatar_url, created_at, updated_at');
  });
  it('ignores caller-supplied identity and admin flags when updating', async () => {
    const db = client(); mocks.createServerClient.mockResolvedValue(db);
    const response = await PUT(new Request('http://local/api/auth/me', { method: 'PUT', body: JSON.stringify({ id: 'another-user', displayName: 'Updated', avatarUrl: null, is_admin: true }) }));
    expect(response.status).toBe(200);
    expect(db.chain.update).toHaveBeenCalledExactlyOnceWith({ display_name: 'Updated', avatar_url: null });
    expect(db.chain.eq).toHaveBeenCalledWith('id', profile.id);
  });
  it('fails closed for invalid profile fields', async () => {
    const response = await PUT(new Request('http://local/api/auth/me', { method: 'PUT', body: JSON.stringify({ displayName: 'x' }) }));
    expect(response.status).toBe(400);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
  it('requires administrator review instead of merging an absent profile by email', async () => {
    mocks.createServerClient.mockResolvedValue(client(null));
    const response = await GET();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('PROFILE_REQUIRED');
  });
  it('never creates a database client for an unauthenticated request', async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await GET()).status).toBe(401);
    expect((await PUT(new Request('http://local/api/auth/me', { method: 'PUT' }))).status).toBe(401);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
