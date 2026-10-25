import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));

import { verifyAdminUser } from '@/lib/admin/auth';

function adminClient(profile: { id: string; is_admin: boolean } | null) {
  const mappingChain = {
    select: vi.fn(() => mappingChain),
    eq: vi.fn(() => mappingChain),
    maybeSingle: vi.fn().mockResolvedValue({ data: { profile_id: 'mapped-profile-id' }, error: null }),
  };
  const profileChain = {
    select: vi.fn(() => profileChain),
    eq: vi.fn(() => profileChain),
    maybeSingle: vi.fn().mockResolvedValue({
      data: profile ? { ...profile, username: 'person', display_name: 'Person', avatar_url: null, created_at: '', updated_at: '' } : null,
      error: null,
    }),
  };
  return {
    from: vi.fn((table: string) => table === 'clerk_user_mappings' ? mappingChain : profileChain),
    mappingChain,
    profileChain,
  };
}

describe('server-side admin profile authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: 'clerk-user-id' });
  });

  it('authorizes only the mapped profile and reads is_admin through the service client', async () => {
    const client = adminClient({ id: 'mapped-profile-id', is_admin: true });
    mocks.createAdminClient.mockReturnValue(client);

    const result = await verifyAdminUser();

    expect(result.authorized).toBe(true);
    expect(result.profile?.is_admin).toBe(true);
    expect(client.mappingChain.eq).toHaveBeenCalledWith('clerk_user_id', 'clerk-user-id');
    expect(client.profileChain.eq).toHaveBeenCalledWith('id', 'mapped-profile-id');
    expect(client.profileChain.select).toHaveBeenCalledWith('id, username, display_name, avatar_url, is_admin, created_at, updated_at');
  });

  it('denies a mapped profile that is not an admin', async () => {
    mocks.createAdminClient.mockReturnValue(adminClient({ id: 'mapped-profile-id', is_admin: false }));
    const result = await verifyAdminUser();
    expect(result.authorized).toBe(false);
    expect(result.error).toContain('FORBIDDEN');
  });

  it('fails closed if the Clerk-to-profile mapping cannot be resolved', async () => {
    const client = adminClient(null);
    client.mappingChain.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.createAdminClient.mockReturnValue(client);
    const result = await verifyAdminUser();
    expect(result.authorized).toBe(false);
    expect(client.from).toHaveBeenCalledTimes(1);
  });
});
