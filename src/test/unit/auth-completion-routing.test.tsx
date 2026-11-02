import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthCompletion } from '@/components/auth/auth-completion';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

describe('Supabase Auth post-auth profile routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    replace.mockReset();
    refresh.mockReset();
  });

  it('routes to Dashboard only after the authenticated profile endpoint validates a profile', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ profile: { id: 'profile-123' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));

    render(<AuthCompletion />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });

  it('shows the existing migration gate instead of redirecting a session without a valid profile', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: 'MIGRATION_REQUIRED', message: 'Administrator review is required.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    ));

    render(<AuthCompletion />);

    expect(await screen.findByText('Administrator review is required.')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
