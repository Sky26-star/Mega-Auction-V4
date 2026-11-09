import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/** The server always validates the Supabase user, including API authorization. */
export const currentUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return error ? null : user;
});

export async function auth() {
  const user = await currentUser();
  return { userId: user?.id || null };
}
