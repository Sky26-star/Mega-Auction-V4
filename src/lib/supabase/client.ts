
import { createBrowserClient } from '@supabase/ssr';
import { getEnv } from '../env';

type ClerkTokenGetter = () => Promise<string | null>;
type ClientOptions = {
  requireAuth?: boolean;
};

let clerkTokenGetter: ClerkTokenGetter | null = null;

export function setClerkTokenGetter(
  getter: ClerkTokenGetter | null
) {
  clerkTokenGetter = getter;
}

export function createClient(
  getClerkToken?: ClerkTokenGetter,
  options: ClientOptions = {}
) {
  const env = getEnv();
  const requireAuth = options.requireAuth === true;

  return createBrowserClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      accessToken: async () => {
        const tokenGetter = getClerkToken ?? clerkTokenGetter;

        if (!tokenGetter) {
          if (requireAuth) {
            throw new Error('Supabase authentication token provider is not initialized.');
          }

          console.error(
            '[Supabase Auth] Clerk token provider is not initialized'
          );
          return null;
        }

        try {
          const token = await tokenGetter();
          if (requireAuth && !token) {
            throw new Error('Supabase authentication token is unavailable.');
          }
          return token;
        } catch {
          if (requireAuth) {
            throw new Error('Failed to retrieve Supabase authentication token.');
          }

          console.error(
            '[Supabase Auth] Failed to retrieve Clerk session token'
          );
          return null;
        }
      },
    }
  );
}
