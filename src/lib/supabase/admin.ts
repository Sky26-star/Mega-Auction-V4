// src/lib/supabase/admin.ts

import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../env';

export function createAdminClient() {
  const env = getEnv();
  if (!env.supabaseServiceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required for admin operations.');
  }

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
