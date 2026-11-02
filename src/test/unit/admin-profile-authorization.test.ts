import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/server-session', () => ({ auth: mocks.auth }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
import { verifyAdminUser } from '@/lib/admin/auth';
function client(profile: unknown) {
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle: vi.fn().mockResolvedValue({ data: profile, error: null }) };
  return { from: vi.fn(() => chain), chain };
}
describe('server-side native admin authorization', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: 'verified-user-id' }); });
  it('reads the verified UUID admin flag through the server-only client', async () => {
    const db = client({ id: 'verified-user-id', is_admin: true });
    mocks.createAdminClient.mockReturnValue(db);
    expect((await verifyAdminUser()).authorized).toBe(true);
    expect(db.from).toHaveBeenCalledExactlyOnceWith('profiles');
    expect(db.chain.eq).toHaveBeenCalledWith('id', 'verified-user-id');
  });
  it('denies ordinary users and missing profiles', async () => {
    for (const profile of [{ id: 'verified-user-id', is_admin: false }, null]) {
      mocks.createAdminClient.mockReturnValue(client(profile));
      expect((await verifyAdminUser()).authorized).toBe(false);
    }
  });
  it('does not access a privileged client for signed-out callers', async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await verifyAdminUser()).authorized).toBe(false);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
