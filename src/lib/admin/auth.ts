// src/lib/admin/auth.ts
// Server-Side Platform Admin Authorization Security Layer

import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { type AdminProfile } from '@/lib/types/auth';

export interface AdminAuthResult {
  authorized: boolean;
  userId: string | null;
  profile: AdminProfile | null;
  error: string | null;
}

/**
 * Server-side authoritative verification of Platform Admin privileges.
 * Resolves the Clerk identity and reads profiles.is_admin only through the
 * server-only service client. Never trusts client-side profile state.
 * Never trusts client-side state flags.
 */
export async function verifyAdminUser(): Promise<AdminAuthResult> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return {
        authorized: false,
        userId: null,
        profile: null,
        error: 'UNAUTHORIZED: Authentication required.',
      };
    }

    const supabase = createAdminClient();
    const { data: mapping, error: mappingError } = await supabase
      .from('clerk_user_mappings')
      .select('profile_id')
      .eq('clerk_user_id', userId)
      .maybeSingle();

    if (mappingError || !mapping?.profile_id) {
      return {
        authorized: false,
        userId,
        profile: null,
        error: 'PROFILE_NOT_FOUND: User profile could not be loaded.',
      };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, is_admin, created_at, updated_at')
      .eq('id', mapping.profile_id)
      .maybeSingle();

    if (profileError || !profile) {
      return {
        authorized: false,
        userId: userId,
        profile: null,
        error: 'PROFILE_NOT_FOUND: User profile could not be loaded.',
      };
    }

    if (!profile.is_admin) {
      return {
        authorized: false,
        userId: userId,
        profile: profile as AdminProfile,
        error: 'FORBIDDEN: You do not have Platform Administrator privileges.',
      };
    }

    return {
      authorized: true,
      userId: userId,
      profile: profile as AdminProfile,
      error: null,
    };
  } catch (err: any) {
    return {
      authorized: false,
      userId: null,
      profile: null,
      error: err?.message || 'INTERNAL_ERROR: Admin verification failed.',
    };
  }
}
