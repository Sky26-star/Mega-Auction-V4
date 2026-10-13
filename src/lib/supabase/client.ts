
import { createBrowserClient } from '@supabase/ssr';
import { getEnv } from '../env';

type ClerkTokenGetter = () => Promise<string | null>;

let clerkTokenGetter: ClerkTokenGetter | null = null;

export function setClerkTokenGetter(
  getter: ClerkTokenGetter | null
) {
  clerkTokenGetter = getter;
}

export function createClient(
  getClerkToken?: ClerkTokenGetter
) {
  const env = getEnv();

  return createBrowserClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      accessToken: async () => {
        const tokenGetter = getClerkToken ?? clerkTokenGetter;

        if (!tokenGetter) {
          console.error(
            '[Supabase Auth] Clerk token provider is not initialized'
          );
          return null;
        }

        try {
          return await tokenGetter();
        } catch (error) {
          console.error(
            '[Supabase Auth] Failed to retrieve Clerk session token:',
            error
          );
          return null;
        }
      },
    }
  );
}
