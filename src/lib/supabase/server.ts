// src/lib/supabase/server.ts

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { auth } from '@clerk/nextjs/server';
import { getEnv } from '../env';

export async function createClient() {
  const cookieStore = await cookies();
  const env = getEnv();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      fetch: async (url: RequestInfo | URL, options?: RequestInit) => {
        try {
          const authParams = await auth().catch(() => null);
          if (authParams?.userId) {
            let clerkToken = null;
            try {
              clerkToken = await authParams.getToken({ template: 'supabase' });
            } catch (err) {
              clerkToken = await authParams.getToken();
            }

            if (clerkToken) {
              const headers = new Headers(options?.headers);
              headers.set('Authorization', `Bearer ${clerkToken}`);
              return fetch(url, { ...options, headers });
            }
          }
        } catch (err) {
          console.warn('Failed to inject Clerk token into Supabase server client:', err);
        }
        return fetch(url, options);
      },
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Handled in middleware
        }
      },
    },
  });
}
