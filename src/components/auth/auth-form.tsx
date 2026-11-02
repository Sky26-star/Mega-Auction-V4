'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { loginSchema, signupSchema } from '@/lib/validations/auth';

export function AuthForm({ initialMode = 'signin' }: { initialMode?: 'signin' | 'signup' }) {
  const { isLoaded, isSignedIn } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (isLoaded && isSignedIn) router.replace('/auth/complete');
  }, [isLoaded, isSignedIn, router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setError(''); setNotice('');
    const input = mode === 'signin' ? loginSchema.safeParse({ email, password })
      : signupSchema.safeParse({ email, password, username, displayName, confirmPassword });
    if (!input.success) { setError(input.error.issues[0]?.message || 'Check your details.'); return; }
    setPending(true);
    try {
      if (mode === 'signin') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
        if (authError) { setError('Sign-in failed. Check your email/password and confirm your email if required.'); return; }
        window.location.assign('/auth/complete');
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(), password,
          options: {
            emailRedirectTo: window.location.origin + '/auth/callback?next=/auth/complete',
            data: { username: username.trim(), display_name: displayName.trim() },
          },
        });
        if (authError) { setError('Account creation failed. Please check your details and try again.'); return; }
        if (data.session) window.location.assign('/auth/complete');
        else setNotice('Check your email for the confirmation link before signing in.');
      }
    } catch { setError('We could not reach the sign-in service. Please try again.'); }
    finally { setPending(false); }
  };

  const inputClass = 'w-full rounded-xl border border-[#2A312D] bg-[#0B0F0D] px-4 py-3 text-sm text-[#F3F4F1] focus:outline-none focus:ring-2 focus:ring-[#C9A227]';
  return <section className="w-full max-w-md rounded-2xl border border-[#2A312D] bg-[#141917] p-6 shadow-xl sm:p-8" aria-label="Account access">
    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#C9A227]">Mega Auction Arena</p>
    <h2 className="text-2xl font-semibold uppercase">{mode === 'signin' ? 'Welcome back' : 'Join the auction'}</h2>
    <p className="mb-6 mt-2 text-sm text-[#9CA6A0]">{mode === 'signin' ? 'Sign in to manage your franchise.' : 'Create your account to join friends and build your squad.'}</p>
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-400/30 p-3 text-sm text-red-300">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-lg border border-[#C9A227]/30 p-3 text-sm text-[#E4B93F]">{notice}</p>}
    <form onSubmit={submit} className="space-y-4">
      {mode === 'signup' && <>
        <label className="block text-xs text-[#9CA6A0]">Display name<input name="displayName" autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} required maxLength={50} className={inputClass + ' mt-1.5'} /></label>
        <label className="block text-xs text-[#9CA6A0]">Username<input name="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={20} className={inputClass + ' mt-1.5'} /></label>
      </>}
      <label className="block text-xs text-[#9CA6A0]">Email address<input name="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required className={inputClass + ' mt-1.5'} /></label>
      <label className="block text-xs text-[#9CA6A0]">Password<input name="password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required className={inputClass + ' mt-1.5'} /></label>
      {mode === 'signup' && <label className="block text-xs text-[#9CA6A0]">Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required className={inputClass + ' mt-1.5'} /></label>}
      <button type="submit" disabled={!isLoaded || pending} className="min-h-11 w-full rounded-xl bg-[#E4B93F] px-4 py-3 text-sm font-bold text-[#0B0F0D] hover:bg-[#C9A227] disabled:opacity-50">{pending ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
    </form>
    <div className="mt-5 flex flex-wrap justify-between gap-3 text-xs">
      <button type="button" disabled={pending} onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setNotice(''); setPassword(''); setConfirmPassword(''); }} className="min-h-10 text-[#E4B93F]">{mode === 'signin' ? 'Create an account' : 'Already have an account? Sign in'}</button>
      <Link href="/forgot-password" className="inline-flex min-h-10 items-center text-[#9CA6A0]">Forgot password?</Link>
    </div>
  </section>;
}
