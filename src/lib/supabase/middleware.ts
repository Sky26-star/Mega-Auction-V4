// src/lib/supabase/middleware.ts

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getEnv } from '../env';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const env = getEnv();

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
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
          console.warn('Failed to inject Clerk token into Supabase middleware client:', err);
        }
        return fetch(url, options);
      },
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refresh auth session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protected route redirects
  const isBuild = process.env.NEXT_PHASE === 'phase-production-build';
  const isPublicRoute =
    isBuild ||
    request.nextUrl.pathname === '/' ||
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/signup') ||
    request.nextUrl.pathname.startsWith('/api') ||
    request.nextUrl.pathname.startsWith('/_next');

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
