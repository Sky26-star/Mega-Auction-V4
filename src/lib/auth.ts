// src/lib/auth.ts
// Client & Server Auth Service Helpers for Mega Auction V1

import { createClient as createBrowserClient } from './supabase/client';
import type { LoginInput, SignupInput, ProfileUpdateInput, ForgotPasswordInput, ResetPasswordInput, Profile } from './types/auth';

/**
 * Sign up a new user via Supabase Auth.
 * Passes username and display_name in raw_user_meta_data so the 
 * PostgreSQL handle_new_user() trigger creates the profile automatically.
 */
export async function signUpUser(data: SignupInput) {
  const supabase = createBrowserClient();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const cleanEmail = data.email.trim().toLowerCase();

  const { data: authData, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password: data.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      data: {
        username: data.username.trim(),
        display_name: data.displayName.trim(),
      },
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return authData;
}

/**
 * Sign in existing user with Email and Password.
 */
export async function signInUser(data: LoginInput) {
  const supabase = createBrowserClient();
  const cleanEmail = data.email.trim().toLowerCase();

  const { data: authData, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password: data.password,
  });

  if (error) {
    throw new Error(error.message);
  }

  return authData;
}

/**
 * Sign out current user session.
 */
export async function signOutUser() {
  const supabase = createBrowserClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Request password recovery email.
 */
export async function requestPasswordReset(data: ForgotPasswordInput) {
  const supabase = createBrowserClient();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const cleanEmail = data.email.trim().toLowerCase();

  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo: `${origin}/reset-password`,
  });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Update password for current authenticated user.
 */
export async function updateUserPassword(data: ResetPasswordInput) {
  const supabase = createBrowserClient();

  const { error } = await supabase.auth.updateUser({
    password: data.password,
  });

  if (error) {
    throw new Error(error.message);
  }
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
    console.error('Failed to fetch current profile via Clerk/Supabase bridge:', error);
    return null;
  }
}

/**
 * Update current user's profile display_name and avatar_url.
 * The API maps Clerk identity to the internal profile id and performs the
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
