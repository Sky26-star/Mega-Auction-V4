// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { getEnv } from '@/lib/env';

describe('Production environment variable and secret guard', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prohibits local Supabase URLs in production environment', () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'prod-anon-key';

    expect(() => getEnv()).toThrow('CRITICAL: Local Supabase URL is forbidden in production environment.');
  });

  it('prohibits localhost Supabase URLs in production environment', () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'prod-anon-key';

    expect(() => getEnv()).toThrow('CRITICAL: Local Supabase URL is forbidden in production environment.');
  });

  it('allows valid remote Supabase URL and anon key in production', () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefghijklm.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'prod-anon-key-12345';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'prod-secret-service-role-key';

    const env = getEnv();
    expect(env.supabaseUrl).toBe('https://abcdefghijklm.supabase.co');
    expect(env.supabaseAnonKey).toBe('prod-anon-key-12345');
    expect(env.supabaseServiceRoleKey).toBe('prod-secret-service-role-key');
  });

  it('never exposes service-role key to client window context', () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefghijklm.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'prod-anon-key-12345';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'prod-secret-service-role-key';

    // Simulate browser window context
    (globalThis as any).window = {};
    try {
      const env = getEnv();
      expect(env.supabaseServiceRoleKey).toBe('');
      expect(env.databaseUrl).toBe('');
    } finally {
      delete (globalThis as any).window;
    }
  });
});
