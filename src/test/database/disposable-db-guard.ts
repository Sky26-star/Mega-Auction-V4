export type DisposableDatabaseTarget =
  | { configured: true; connectionString: string }
  | { configured: false; reason: string };

const SKIP_REASON =
  'DISPOSABLE_TEST_DATABASE_URL is unset; the PostgreSQL integration suite is skipped.';

function invalidTarget(): Error {
  return new Error(
    'DISPOSABLE_TEST_DATABASE_URL must identify a PostgreSQL database at exactly 127.0.0.1:55325.'
  );
}

/**
 * Resolve the only connection target permitted for disposable PostgreSQL tests.
 * This function is pure: callers supply the environment and it performs no I/O.
 */
export function resolveDisposableDatabaseTarget(
  env: Readonly<Record<string, string | undefined>>
): DisposableDatabaseTarget {
  const connectionString = env.DISPOSABLE_TEST_DATABASE_URL;

  if (connectionString === undefined) {
    return { configured: false, reason: SKIP_REASON };
  }

  if (connectionString.trim().length === 0) {
    throw new Error('DISPOSABLE_TEST_DATABASE_URL is empty; the target was rejected.');
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('DISPOSABLE_TEST_DATABASE_URL is malformed; the target was rejected.');
  }

  const postgresScheme = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  const hasRoutingOverride = Array.from(parsed.searchParams.keys()).some((key) =>
    ['host', 'hostaddr', 'port'].includes(key.toLowerCase())
  );

  if (
    !postgresScheme ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== '55325' ||
    parsed.pathname.length <= 1 ||
    parsed.hash.length > 0 ||
    hasRoutingOverride
  ) {
    throw invalidTarget();
  }

  return { configured: true, connectionString };
}
