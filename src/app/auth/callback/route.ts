// src/app/auth/callback/route.ts
// Supabase PKCE OAuth & Email Link Code Exchange Handler

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeAuthRedirect } from '@/lib/auth/redirect';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeAuthRedirect(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Return user to login page with an error parameter if code exchange failed
  return NextResponse.redirect(`${origin}/login?error=Could%20not%20authenticate%20user`);
}
