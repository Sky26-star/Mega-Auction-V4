import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types/auth';

/**
 * Loads the signed-in user's profile through ordinary RLS after resolving the
 * Clerk identity to its internal Supabase profile id. The service client is
 * used only for this identity mapping, never to read the profile row.
 */
export async function getCurrentMappedProfile(): Promise<Profile | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const admin = createAdminClient();
  const { data: mapping, error: mappingError } = await admin
    .from('clerk_user_mappings')
    .select('profile_id')
    .eq('clerk_user_id', userId)
    .maybeSingle();

  if (mappingError || !mapping?.profile_id) return null;

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, created_at, updated_at')
    .eq('id', mapping.profile_id)
    .maybeSingle();

  if (error || !data) return null;
  return data as Profile;
}
