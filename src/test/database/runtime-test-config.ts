const TEST_ENV_KEYS = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
] as const;

type Environment = Record<string, string | undefined>;

export type IsolatedRlsConfig = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

const E2E_MUTATION_OPT_IN = 'E2E_ALLOW_DATABASE_MUTATIONS';
const E2E_PREFLIGHT_CONFIRMATION = 'E2E_DISPOSABLE_DB_PREFLIGHT_CONFIRMED';
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1']);

const APPROVED_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function validateIsolatedUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('SUPABASE_TEST_URL must be an approved loopback URL on port 55321.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    parsed.protocol !== 'http:' ||
    !APPROVED_LOOPBACK_HOSTS.has(hostname) ||
    parsed.port !== '55321' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('SUPABASE_TEST_URL must be an approved loopback URL on port 55321.');
  }

  return parsed.origin;
}

/**
 * The mutating RLS suite only accepts an explicit isolated target. It never
 * falls back to ambient Supabase settings or values loaded from a local env file.
 */
export function resolveIsolatedRlsConfig(env: Environment): IsolatedRlsConfig | null {
  const suppliedKeys = TEST_ENV_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(env, key)
  );

  if (suppliedKeys.length === 0) return null;

  const values = TEST_ENV_KEYS.map((key) => env[key]);
  if (values.some((value) => typeof value !== 'string' || value.trim() === '')) {
    throw new Error('Set all three SUPABASE_TEST_* variables to run the isolated RLS suite.');
  }

  return {
    url: validateIsolatedUrl(values[0]!),
    anonKey: values[1]!,
    serviceRoleKey: values[2]!,
  };
}

/**
 * Resolve the explicitly opted-in target for database-mutating Playwright tests.
 * Reuses the runtime RLS URL/credential guard, then narrows host acceptance to
 * literal loopback IPs. The preflight flag is an operator attestation that the
 * documented container/volume/binding checks were completed; it is not inferred
 * from the URL itself.
 */
export function resolveIsolatedE2EDatabaseConfig(env: Environment): IsolatedRlsConfig {
  if (env[E2E_MUTATION_OPT_IN] !== '1') {
    throw new Error(`${E2E_MUTATION_OPT_IN} is required.`);
  }

  if (env[E2E_PREFLIGHT_CONFIRMATION] !== '1') {
    throw new Error(`${E2E_PREFLIGHT_CONFIRMATION} is required after the documented disposable database preflight.`);
  }

  for (const key of TEST_ENV_KEYS) {
    if (typeof env[key] !== 'string' || env[key]!.trim() === '') {
      throw new Error(`${key} is required.`);
    }
  }

  // Require canonical IP-literal spelling before the shared URL parser
  // normalizes hostnames such as integer/short IPv4 representations.
  if (!/^http:\/\/(?:127\.0\.0\.1|\[::1\]):55321\/?$/i.test(env.SUPABASE_TEST_URL!)) {
    throw new Error('SUPABASE_TEST_URL must use 127.0.0.1 or [::1] on port 55321.');
  }

  const config = resolveIsolatedRlsConfig(env);
  if (!config) {
    throw new Error('SUPABASE_TEST_URL is required.');
  }

  const hostname = new URL(config.url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!LOOPBACK_IPS.has(hostname)) {
    throw new Error('SUPABASE_TEST_URL must use a loopback IP on port 55321.');
  }

  return config;
}

export function formatIsolatedTarget(url: string): string {
  return `[ISOLATED RLS TEST] target: ${url}`;
}
