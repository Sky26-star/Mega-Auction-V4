'use strict';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

async function checkLocalSupabase(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let url;
  try {
    url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321');
  } catch {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be an HTTP(S) URL without credentials or query parameters.');
  }
  // This is a local dependency check, not a probe of hosted projects.
  if (!LOOPBACK_HOSTS.has(url.hostname)) return;
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required for the local Supabase readiness check.');
  }

  const endpoint = url.origin;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 3_000);
  try {
    const response = await fetchImpl(`${endpoint}/auth/v1/health`, {
      method: 'GET',
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    });
    await response.body?.cancel();
    if (response.status !== 200) {
      throw new Error(`Local Supabase at ${endpoint} returned HTTP ${response.status}. Check service health and the configured local API key.`);
    }
  } catch (error) {
    if (error?.message?.startsWith(`Local Supabase at ${endpoint} returned HTTP `)) throw error;
    // Fetch errors can contain URLs or headers: do not print their raw contents.
    throw new Error(`Local Supabase is unavailable at ${endpoint}. Start Docker Desktop and the verified local Supabase stack, then run npm run dev again.`);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { checkLocalSupabase };

if (require.main === module) {
  // Match Next.js development environment-file precedence without loading files in tests.
  require('@next/env').loadEnvConfig(process.cwd(), true);
  checkLocalSupabase().then(() => {
    console.log('[DEV-PREFLIGHT] Supabase dependency check passed.');
  }).catch(error => {
    console.error(`[DEV-PREFLIGHT] ${error.message}`);
    process.exitCode = 1;
  });
}
