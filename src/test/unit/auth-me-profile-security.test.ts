import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth, currentUser: mocks.currentUser }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createServerClient }));

import { GET, PUT } from '@/app/api/auth/me/route';

const profile = {
  id: 'mapped-profile-id',
  username: 'owner',
  display_name: 'Room Owner',
  avatar_url: 'https://example.test/avatar.png',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function mappingClient() {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data: { profile_id: 'mapped-profile-id' }, error: null }),
  };
  return { from: vi.fn(() => chain), chain };
}

describe('own-profile API privacy boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: 'clerk-user-id' });
  });

  it('reads only the authenticated user mapped profile through ordinary RLS', async () => {
    const admin = mappingClient();
    mocks.createAdminClient.mockReturnValue(admin);
    const profileChain = {
      select: vi.fn(() => profileChain),
      eq: vi.fn(() => profileChain),
      single: vi.fn().mockResolvedValue({ data: profile, error: null }),
    };
    const userClient = { from: vi.fn(() => profileChain) };
    mocks.createServerClient.mockResolvedValue(userClient);

    const response = await GET();
    const payload = await response.json();

    expect(admin.from).toHaveBeenCalledWith('clerk_user_mappings');
    expect(admin.chain.eq).toHaveBeenCalledWith('clerk_user_id', 'clerk-user-id');
    expect(userClient.from).toHaveBeenCalledWith('profiles');
    expect(profileChain.select).toHaveBeenCalledWith('id, username, display_name, avatar_url, created_at, updated_at');
    expect(profileChain.eq).toHaveBeenCalledWith('id', 'mapped-profile-id');
    expect(payload.profile).toEqual({
      id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    });
    expect(payload.profile).not.toHaveProperty('is_admin');
  });

  it('updates only the mapped profile through ordinary RLS and cannot accept a caller-supplied id', async () => {
    const admin = mappingClient();
    mocks.createAdminClient.mockReturnValue(admin);
    const updateChain = {
      update: vi.fn((values: Record<string, unknown>) => {
        void values;
        return updateChain;
      }),
      eq: vi.fn(() => updateChain),
      select: vi.fn(() => updateChain),
      single: vi.fn().mockResolvedValue({ data: profile, error: null }),
    };
    const userClient = { from: vi.fn(() => updateChain) };
    mocks.createServerClient.mockResolvedValue(userClient);

    const response = await PUT(new Request('http://local/api/auth/me', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'attacker-chosen-id', displayName: 'Updated', avatarUrl: null }),
    }));
    const payload = await response.json();

    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Updated', avatar_url: null }));
    expect(updateChain.update.mock.calls[0]?.[0]).not.toHaveProperty('is_admin');
    expect(updateChain.update.mock.calls[0]?.[0]).not.toHaveProperty('updated_at');
    expect(updateChain.eq).toHaveBeenCalledWith('id', 'mapped-profile-id');
    expect(updateChain.select).toHaveBeenCalledWith('id, username, display_name, avatar_url, created_at, updated_at');
    expect(payload.profile).not.toHaveProperty('is_admin');
  });

  it('does not create a database client when the request is unauthenticated', async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
