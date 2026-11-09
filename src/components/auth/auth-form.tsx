'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { oauthErrorMessage } from '@/lib/auth/oauth-errors';

type SocialProvider = 'google' | 'github';

export function AuthForm() {
  const { isLoaded, isSignedIn } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError(oauthErrorMessage(new URLSearchParams(window.location.search).get('error')));
    const reset = () => { busy.current = false; setPending(null); };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) router.replace('/auth/complete');
  }, [isLoaded, isSignedIn, router]);

  const signIn = async (provider: SocialProvider) => {
    if (!isLoaded || busy.current) return;
    if (isSignedIn) { router.replace('/auth/complete'); return; }
    busy.current = true;
    setPending(provider);
    setError('');
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: new URL('/auth/callback', window.location.origin).href },
      });
      if (authError) throw authError;
      // The SDK navigates to Supabase's provider authorization endpoint.
      // Keep controls disabled until navigation or a browser-back pageshow.
    } catch {
      setError('We could not start sign-in. Please try again.');
      busy.current = false;
      setPending(null);
    }
  };

  if (!isLoaded || isSignedIn) return (
    <div className="w-full max-w-md p-7 sm:p-9 rounded-2xl bg-[#141917] border border-[#2A312D] shadow-2xl shadow-black/90 backdrop-blur-xl relative z-10 flex items-center justify-center min-h-[260px]" role="status">
      <div className="text-center"><div className="text-[#E4B93F] text-sm font-black uppercase tracking-[0.18em] animate-pulse">Entering Auction Arena...</div><div className="mt-3 text-[#68716B] text-[10px] font-bold uppercase tracking-widest">Please wait</div></div>
    </div>
  );

  const buttonClass = 'w-full py-3.5 px-5 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] text-[#F3F4F1] font-bold text-[11px] sm:text-xs uppercase tracking-widest shadow-xl border border-[#2A312D] transition-all min-h-[52px] flex items-center justify-center gap-3 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]';
  return (
    <section className="w-full max-w-md p-7 sm:p-9 rounded-2xl bg-[#141917] border border-[#2A312D] shadow-2xl shadow-black/90 backdrop-blur-xl transition-all relative z-10" aria-label="Account access">
      <div className="text-center mb-6"><h2 className="text-[#F3F4F1] font-black text-sm sm:text-base uppercase tracking-[0.15em] drop-shadow-md">Welcome to Mega Auction Arena</h2></div>
      {error && <p role="alert" className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center font-bold tracking-wide">{error}</p>}
      <div className="flex flex-col space-y-3" aria-busy={pending !== null}>
        <button type="button" onClick={() => { void signIn('google'); }} disabled={pending !== null} className={buttonClass}>
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg><span>Continue with Google</span>
        </button>
        <button type="button" onClick={() => { void signIn('github'); }} disabled={pending !== null} className={buttonClass}>
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg><span>Continue with GitHub</span>
        </button>
      </div>
      {pending && <p role="status" className="mt-4 text-center text-xs text-[#9CA6A0]">Connecting to {pending === 'google' ? 'Google' : 'GitHub'}...</p>}
    </section>
  );
}
