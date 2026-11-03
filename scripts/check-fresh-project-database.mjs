// Local-only replay of the audited fresh-project defaults and legacy CI defaults.
// Never accepts a database URL or connects to Supabase. Requires a NEW, labelled,
// network-isolated PostgreSQL 17 Docker container with tmpfs data and no mounts.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const container = process.argv[process.argv.indexOf('--container') + 1];
const reportFile = process.argv.includes('--report')
  ? process.argv[process.argv.indexOf('--report') + 1] : undefined;
const results = [];
const forward = 'supabase/migrations/20261104100000_explicit_runtime_reads_and_mini_realtime.sql';
const bridge = readFileSync('supabase/operations/fresh-project-profile-acl.sql', 'utf8');
const guardedMigration = 'supabase/migrations/20261017100000_room_scoped_profile_access.sql';
const docker = args => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
// Compare Git text independent of core.autocrlf without rewriting any file.
const hash = value => createHash('sha256').update(value.toString().replace(/\r\n/g, '\n')).digest('hex');
function record(step, detail = {}) {
  const result = { step, ...detail };
  results.push(result);
  if (reportFile) writeFileSync(reportFile, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(result));
}
function guard() {
  if (!process.argv.includes('--container') || !/^[a-zA-Z0-9_.-]+$/.test(container || '')) {
    throw Error('Pass the explicitly created disposable --container ID.');
  }
  const target = JSON.parse(docker(['inspect', container]))[0];
  if (!target.Config.Labels?.['mega-auction.purpose']?.startsWith('fresh-project-validation-')
    || target.HostConfig.NetworkMode !== 'none'
    || Object.keys(target.HostConfig.PortBindings || {}).length
    || target.Mounts.some(m => m.Type !== 'tmpfs')
    || !Object.hasOwn(target.HostConfig.Tmpfs || {}, '/var/lib/postgresql/data')
    || !target.State.Running) throw Error('Unsafe or unavailable disposable container.');
}
function query(database, sql, allowFailure = false) {
  guard();
  if (!['mega_auction_test', 'mega_auction_legacy_test'].includes(database)) throw Error('Unsafe database name.');
  const result = spawnSync('docker', [
    'exec', '-i', container, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
    '-h', '/var/run/postgresql', '-p', '55325', '-U', 'postgres', '-d', database,
  ], { input: sql.replace(/\r\n/g, '\n'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0 && !allowFailure) throw Error(result.stderr || result.error?.message || 'psql failed');
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
const fingerprintSql = `SELECT md5(string_agg(value, E'\n' ORDER BY value)) FROM (
  SELECT pg_get_functiondef(p.oid) || coalesce(p.proacl::text, '') AS value
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  UNION ALL SELECT schemaname || tablename || policyname || coalesce(qual,'') || coalesce(with_check,'')
    FROM pg_policies WHERE schemaname='public'
) definitions;`;
try {
  guard();
  const files = docker(['exec', container, 'postgres', '--version']).trim();
  record('runtime', { postgres: files, hostedConnections: 0, publishedPorts: 0 });
  const tracked = execFileSync('git', ['ls-files', 'supabase/migrations/*.sql'], { encoding: 'utf8' })
    .trim().split(/\r?\n/).filter(file => file !== forward).sort();
  if (tracked.length !== 75) throw Error(`Expected 75 historical migrations; found ${tracked.length}.`);
  for (const file of tracked) {
    if (hash(readFileSync(file)) !== hash(execFileSync('git', ['show', `HEAD:${file}`]))) {
      throw Error(`Historical migration changed: ${file}`);
    }
  }
  const bootstrap = readFileSync('scripts/ci-db-bootstrap.sql', 'utf8');
  const modernBootstrap = bootstrap.replace(/^ALTER DEFAULT PRIVILEGES[^;]+;\s*$/gm, '') + `
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO postgres;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
  `;
  // A second NEW database in this disposable container proves legacy defaults
  // also converge. Refuse existing databases instead of resetting or deleting.
  if (query('mega_auction_test', "SELECT count(*) FROM pg_database WHERE datname='mega_auction_legacy_test';").stdout.trim() !== '0') {
    throw Error('Legacy rehearsal database already exists; use a new disposable container.');
  }
  docker(['exec', container, 'createdb', '-h', '/var/run/postgresql', '-p', '55325', '-U', 'postgres', 'mega_auction_legacy_test']);
  for (const [mode, database, setup] of [
    ['modern', 'mega_auction_test', modernBootstrap],
    ['legacy-ci', 'mega_auction_legacy_test', bootstrap],
  ]) {
    if (query(database, "SELECT count(*) FROM pg_tables WHERE schemaname='public';").stdout.trim() !== '0') {
      throw Error('Disposable database is not empty; refusing to overwrite it.');
    }
    query(database, setup);
    for (const [index, file] of tracked.entries()) {
      if (file === guardedMigration) {
        if (mode === 'modern') {
          const failure = query(database, readFileSync(file, 'utf8'), true);
          if (failure.status === 0 || !failure.stderr.includes('resolve_user_id() has an unreviewed ACL')) {
            throw Error(`Expected the historical direct-grant preflight failure, received: ${failure.stderr}`);
          }
          record('unpatched-modern-failure-reproduced', { file, error: failure.stderr.trim() });
        }
        query(database, bridge);
        record('compatibility-prerequisite', { mode, before: file });
      }
      query(database, readFileSync(file, 'utf8'));
      record('canonical-migration', { mode, position: index + 1, file, passed: true });
    }
    const before = query(database, fingerprintSql).stdout.trim();
    query(database, readFileSync(forward, 'utf8'));
    query(database, readFileSync(forward, 'utf8'));
    if (before !== query(database, fingerprintSql).stdout.trim()) throw Error('Runtime grant migration modified an RPC or policy.');
    const rejected = query(database, bridge, true);
    if (rejected.status === 0 || !rejected.stderr.includes('pre-hardening identity resolver')) {
      throw Error('Compatibility step was not rejected after final hardening.');
    }
    const assertions = query(database, readFileSync('scripts/fresh-project-database-assertions.sql', 'utf8'));
    record('runtime-security-assertions', { mode, passed: true, assertions: (assertions.stderr.match(/NOTICE:\s+PASS:/g) || []).length,
      policyAndFunctionFingerprintUnchanged: true, forwardMigrationIdempotent: true, lateBridgeRejected: true });
    const counts = query(database, `SELECT json_build_object(
      'tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
      'players',(SELECT count(*) FROM public.players),
      'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
      'publication_members',(SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime'),
      'fixture_users',(SELECT count(*) FROM auth.users));`).stdout.trim();
    record('replay-complete', { mode, historicalMigrations: tracked.length, forwardMigrations: 1, catalog: JSON.parse(counts) });
  }
  record('complete', { passed: true });
} catch (error) {
  record('failed', { passed: false, error: error.message });
  process.exitCode = 1;
}
