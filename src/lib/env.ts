// src/lib/env.ts

import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

export function getEnv() {
  const isClient = typeof window !== 'undefined';
  const isProd = process.env.NODE_ENV === 'production';

  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    SUPABASE_SERVICE_ROLE_KEY: isClient ? undefined : process.env.SUPABASE_SERVICE_ROLE_KEY,
    DATABASE_URL: isClient ? undefined : process.env.DATABASE_URL,
  });

  if (!parsed.success && !isProd) {
    console.warn('Environment variable validation warnings:', parsed.error.format());
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || (!isProd ? 'http://127.0.0.1:54321' : '');
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || (!isProd ? 'placeholder_anon_key' : '');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (!isProd ? 'http://localhost:3000' : '');
  const supabaseServiceRoleKey = isClient ? '' : (process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  const databaseUrl = isClient ? '' : (process.env.DATABASE_URL || '');

  if (isProd) {
    if (!supabaseUrl || supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost')) {
      throw new Error('CRITICAL: Local Supabase URL is forbidden in production environment.');
    }
    if (!supabaseAnonKey) {
      throw new Error('CRITICAL: NEXT_PUBLIC_SUPABASE_ANON_KEY is required in production.');
    }
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    appUrl,
    supabaseServiceRoleKey,
    databaseUrl,
  };
}
