// Native social authentication uses AuthForm and the PKCE callback.
import { createClient as createBrowserClient } from './supabase/client';
import type { ProfileUpdateInput, Profile } from './types/auth';

/** Sign out the shared native session. */
export async function signOutUser() {
  const supabase = createBrowserClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

/**
 * Fetch profile for the currently logged-in user.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.profile || null;
  } catch (error) {
    console.error('Failed to fetch current profile via Supabase Auth/Supabase bridge:', error);
    return null;
  }
}

/**
 * Update current user's profile display_name and avatar_url.
 * The API maps Supabase Auth identity to the internal profile id and performs the
 * update through the caller's authenticated Supabase client/RLS. Never updates
 * is_admin or username.
 */
export async function updateCurrentProfile(data: ProfileUpdateInput): Promise<Profile> {
  const res = await fetch('/api/auth/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || 'Failed to update profile');
  }

  const json = await res.json();
  return json.profile as Profile;
}
