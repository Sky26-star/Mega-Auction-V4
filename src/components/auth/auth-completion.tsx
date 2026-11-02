'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type AuthMeResponse = {
  profile?: { id?: string } | null;
  error?: string;
  message?: string;
};

export function AuthCompletion() {
  const router = useRouter();
  const started = useRef(false);
  const [message, setMessage] = useState('Checking your auction profile…');

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        const result = await response.json() as AuthMeResponse;
        if (response.ok && result.profile?.id) {
          router.replace('/dashboard');
          router.refresh();
          return;
        }

        if (result.error === 'MIGRATION_REQUIRED') {
          setMessage(result.message || 'This account needs an administrator to complete its profile migration.');
          return;
        }

        if (response.status === 401) {
          setMessage('Your sign-in session could not be confirmed. Please sign in again.');
          return;
        }

        setMessage('We could not validate your auction profile. Please try again or contact support.');
      })
      .catch(() => {
        setMessage('We could not reach the profile service. Please refresh this page to retry.');
      });
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-slate-100">
      <p role="status" aria-live="polite">{message}</p>
      {message !== 'Checking your auction profile…' && (
        <a className="text-amber-300 underline" href="/sign-in">Return to sign in</a>
      )}
    </main>
  );
}
