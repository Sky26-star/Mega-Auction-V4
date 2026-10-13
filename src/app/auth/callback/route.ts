// src/app/auth/callback/route.ts
// Supabase PKCE OAuth & Email Link Code Exchange Handler

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const isRelative = next.startsWith('/') && !next.startsWith('//');
      const redirectUrl = isRelative ? `${origin}${next}` : `${origin}/dashboard`;
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Return user to login page with an error parameter if code exchange failed
  return NextResponse.redirect(`${origin}/login?error=Could%20not%20authenticate%20user`);
}
