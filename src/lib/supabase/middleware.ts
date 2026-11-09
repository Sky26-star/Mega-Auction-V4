import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '../env';

export function isProtectedPath(pathname: string) {
  return ['/dashboard', '/profile', '/rooms'].some(base => pathname === base || pathname.startsWith(base + '/'));
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // Tick authentication is independent of browser sessions. Never do an Auth
  // network request for every scheduler invocation or public static page.
  const hasSessionCookie = request.cookies.getAll().some(cookie => cookie.name.startsWith('sb-'));
  if (!isProtectedPath(pathname) && !hasSessionCookie) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const env = getEnv();
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values: { name: string; value: string; options: CookieOptions }[]) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Verify with Auth, not a client-supplied session object.
  const { data: { user }, error } = await supabase.auth.getUser();
  if (isProtectedPath(pathname) && (error || !user)) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = '';
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    return redirect;
  }
  return response;
}
