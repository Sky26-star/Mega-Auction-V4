import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getSession: mocks.getSession, signOut: mocks.signOut, onAuthStateChange: mocks.subscribe } }) }));
import { AuthProvider, useAuth } from '@/components/providers/auth-provider';
const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;
const user = { id: '11111111-1111-4111-8111-111111111111' };
let notify: (event: string, session: unknown) => void;
describe('native social session infrastructure', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.getSession.mockResolvedValue({ data: { session: { user, access_token: 'native-token' } }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.subscribe.mockImplementation(callback => { notify = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; });
  });
  afterEach(cleanup);
  it('restores the same UUID and token from the persisted session on refresh', async () => {
    const first = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(first.result.current.userId).toBe(user.id)); first.unmount();
    const second = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(second.result.current.isSignedIn).toBe(true));
    expect(second.result.current.userId).toBe(user.id); expect(await second.result.current.getToken()).toBe('native-token');
  });
  it('updates refreshed tokens without changing account identity', async () => {
    const { result } = renderHook(useAuth, { wrapper }); await waitFor(() => expect(result.current.isLoaded).toBe(true));
    mocks.getSession.mockResolvedValue({ data: { session: { user, access_token: 'refreshed-token' } }, error: null });
    act(() => notify('TOKEN_REFRESHED', { user, access_token: 'refreshed-token' }));
    expect(await result.current.getToken()).toBe('refreshed-token'); expect(result.current.userId).toBe(user.id);
  });
  it('signs out and clears the native user', async () => {
    const { result } = renderHook(useAuth, { wrapper }); await waitFor(() => expect(result.current.isSignedIn).toBe(true));
    await act(async () => result.current.signOut());
    expect(mocks.signOut).toHaveBeenCalledOnce(); expect(result.current.userId).toBeNull(); expect(result.current.isSignedIn).toBe(false);
  });
  it('does not claim logout succeeded if the Auth service rejected it', async () => {
    mocks.signOut.mockResolvedValue({ error: new Error('private') });
    const { result } = renderHook(useAuth, { wrapper }); await waitFor(() => expect(result.current.isSignedIn).toBe(true));
    await expect(result.current.signOut()).rejects.toThrow('Sign out failed'); expect(result.current.userId).toBe(user.id);
  });
  it('does not overwrite a newer auth event with stale initial session state', async () => {
    let resolve!: (value: unknown) => void;
    mocks.getSession.mockReturnValue(new Promise(r => { resolve = r; }));
    const { result, unmount } = renderHook(useAuth, { wrapper });
    act(() => notify('SIGNED_IN', { user }));
    await act(async () => resolve({ data: { session: null }, error: null }));
    expect(result.current.userId).toBe(user.id); unmount(); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
