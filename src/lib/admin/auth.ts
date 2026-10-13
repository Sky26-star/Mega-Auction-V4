// src/lib/admin/auth.ts
// Server-Side Platform Admin Authorization Security Layer

import { auth } from '@clerk/nextjs/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { type Profile } from '@/lib/types/auth';

export interface AdminAuthResult {
  authorized: boolean;
  userId: string | null;
  profile: Profile | null;
  error: string | null;
}

/**
 * Server-side authoritative verification of Platform Admin privileges.
 * Queries auth session and profiles.is_admin directly from database.
 * Never trusts client-side state flags.
 */
export async function verifyAdminUser(): Promise<AdminAuthResult> {
  try {
    const supabase = await createServerClient();
    const { userId } = await auth();
    if (!userId) {
      return {
        authorized: false,
        userId: null,
        profile: null,
        error: 'UNAUTHORIZED: Authentication required.',
      };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
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
        profile: profile as Profile,
        error: 'FORBIDDEN: You do not have Platform Administrator privileges.',
      };
    }

    return {
      authorized: true,
      userId: userId,
      profile: profile as Profile,
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
