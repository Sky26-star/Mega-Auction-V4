'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type AuthContextValue = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  user: User | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let receivedAuthEvent = false;
    // Session state here controls presentation only. Server handlers and RLS
    // independently verify identity before reading or changing protected data.
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!cancelled && !receivedAuthEvent) {
        setUser(error ? null : data.session?.user || null);
        setIsLoaded(true);
      }
    }).catch(() => {
      if (!cancelled && !receivedAuthEvent) { setUser(null); setIsLoaded(true); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      receivedAuthEvent = true;
      if (!cancelled) { setUser(session?.user || null); setIsLoaded(true); }
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [supabase]);

  const getToken = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error('Authentication session could not be refreshed.');
    return data.session?.access_token || null;
  }, [supabase]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error('Sign out failed. Please try again.');
    setUser(null);
  }, [supabase]);

  const value = useMemo(() => ({ isLoaded, isSignedIn: Boolean(user), userId: user?.id || null, user, getToken, signOut }), [isLoaded, user, getToken, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
