import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ oauth: vi.fn(), replace: vi.fn(), auth: { isLoaded: true, isSignedIn: false } }));
vi.mock('@/components/providers/auth-provider', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithOAuth: mocks.oauth } }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
import { AuthForm } from '@/components/auth/auth-form';

describe('Google and GitHub social-only card', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.isLoaded = true; mocks.auth.isSignedIn = false; mocks.oauth.mockResolvedValue({ error: null }); window.history.replaceState({}, '', '/sign-in'); });
  afterEach(cleanup);
  it('offers exactly two providers and no password/signup/recovery controls', () => {
    const { container } = render(<AuthForm />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
    expect(container.querySelector('input,form,a')).toBeNull();
    expect(screen.getByText('Welcome to Mega Auction Arena')).toBeVisible();
  });
  it.each(['google', 'github'] as const)('starts official %s PKCE flow for returning or new accounts', async provider => {
    render(<AuthForm />);
    fireEvent.click(screen.getByRole('button', { name: provider === 'google' ? 'Continue with Google' : 'Continue with GitHub' }));
    await waitFor(() => expect(mocks.oauth).toHaveBeenCalledExactlyOnceWith({ provider, options: { redirectTo: window.location.origin + '/auth/callback' } }));
    expect(screen.getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true);
  });
  it('handles a provider failure without displaying private error details', async () => {
    mocks.oauth.mockResolvedValue({ error: new Error('private provider response') });
    render(<AuthForm />); fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not start sign-in');
    expect(screen.queryByText(/private provider response/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).not.toBeDisabled();
  });
  it('handles network rejection and allows another attempt', async () => {
    mocks.oauth.mockRejectedValue(new Error('network'));
    render(<AuthForm />); fireEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Continue with Google' })).not.toBeDisabled();
  });
  it('shows cancellation feedback from the callback', async () => {
    window.history.replaceState({}, '', '/sign-in?error=oauth_cancelled'); render(<AuthForm />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in was cancelled');
  });
  it('ignores unrecognized callback text', () => {
    window.history.replaceState({}, '', '/sign-in?error=untrusted-text'); render(<AuthForm />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('redirects an existing session to profile validation', async () => {
    mocks.auth.isSignedIn = true; render(<AuthForm />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/auth/complete'));
    expect(mocks.oauth).not.toHaveBeenCalled();
  });
  it('does not start OAuth before native session initialization', () => {
    mocks.auth.isLoaded = false; render(<AuthForm />);
    expect(screen.queryByRole('button')).toBeNull(); expect(mocks.oauth).not.toHaveBeenCalled();
  });
  it('unlocks the card after browser-back navigation', async () => {
    render(<AuthForm />); fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(mocks.oauth).toHaveBeenCalled());
    act(() => window.dispatchEvent(new Event('pageshow')));
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).not.toBeDisabled();
  });
});
