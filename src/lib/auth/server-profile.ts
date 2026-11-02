import 'server-only';
import { auth } from '@/lib/auth/server-session';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types/auth';

/** Supabase Auth user IDs are the profile primary keys. Never merge by email. */
export async function getCurrentMappedProfile(): Promise<Profile | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from('profiles')
    .select('id, username, display_name, avatar_url, created_at, updated_at')
    .eq('id', userId).maybeSingle();
  return error || !data ? null : data as Profile;
}
