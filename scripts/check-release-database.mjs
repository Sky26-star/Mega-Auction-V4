// Rehearse native identity and the scheduler only in an isolated release database.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const docker = process.argv.includes('--docker');
const container = 'mega-auction-native-release-check-20261102';
const operation = readFileSync('supabase/operations/auction-scheduler.sql', 'utf8')
  .replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
// This guarded rollback-only suite tests the retained LEGACY compatibility path.
// Native DATABASE ownership and service-role denial have a separate real suite.
const legacyMode = `DO $$ BEGIN IF to_regclass('auction_recovery.control') IS NOT NULL THEN
 UPDATE auction_recovery.control SET delivery_owner='LEGACY'; END IF; END $$;`;
const sql = `BEGIN;\n${readFileSync('scripts/release-database-mocks.sql', 'utf8')}\n${legacyMode}\n${operation}\n${readFileSync('scripts/release-database-assertions.sql', 'utf8')}\nROLLBACK;`;
const file = join(mkdtempSync(join(tmpdir(), 'mega-auction-release-')), 'check.sql');
writeFileSync(file, sql);
try {
  if (docker) {
    const details = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
    if (details.Config.Labels['mega-auction.purpose'] !== 'isolated-release-check' || details.HostConfig.NetworkMode !== 'none' || Object.keys(details.HostConfig.PortBindings || {}).length) throw Error('Unsafe test container.');
    execFileSync('docker', ['cp', file, `${container}:/tmp/release-check.sql`]);
    execFileSync('docker', ['exec', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'mega_auction_release_check', '-f', '/tmp/release-check.sql'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    const url = new URL(process.env.DISPOSABLE_TEST_DATABASE_URL || '');
    if (url.hostname !== '127.0.0.1' || url.port !== '55325' || url.pathname !== '/mega_auction_test' || url.search || !['postgres:', 'postgresql:'].includes(url.protocol)) throw Error('Unsafe test database target.');
    execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-h', url.hostname, '-p', url.port, '-U', decodeURIComponent(url.username), '-d', 'mega_auction_test', '-f', file], { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
  console.log('Passed: native profile/RLS/room lifecycle and scheduler SQL assertions. All fixtures rolled back; HTTP transport was mocked.');
} catch (error) {
  console.error(error.stderr?.toString().slice(-5000) || error.message);
  process.exitCode = 1;
}
