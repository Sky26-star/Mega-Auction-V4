import { createBrowserClient } from '@supabase/ssr';
import { getEnv } from '../env';

/** One cookie-backed Supabase session powers Auth, REST and Realtime. */
export function createClient() {
  const env = getEnv();
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
