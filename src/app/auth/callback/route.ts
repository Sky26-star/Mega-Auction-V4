// src/app/auth/callback/route.ts
// Supabase social sign-in PKCE code exchange.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeAuthRedirect } from '@/lib/auth/redirect';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeAuthRedirect(searchParams.get('next'));
  const fail = (reason: string) => {
    const url = new URL('/sign-in', origin);
    url.searchParams.set('error', reason);
    const response = NextResponse.redirect(url);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  if (searchParams.has('error') || searchParams.has('error_code')) {
    return fail(searchParams.get('error') === 'access_denied' || searchParams.get('error_code') === 'access_denied'
      ? 'oauth_cancelled' : 'oauth_failed');
  }
  if (!code || code.length > 4096) return fail('invalid_callback');

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(new URL(next, origin));
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    return fail('invalid_callback');
  } catch { return fail('oauth_unavailable'); }
}
