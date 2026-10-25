import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveIsolatedE2EDatabaseConfig } from '../database/runtime-test-config';

const validTarget = {
  E2E_ALLOW_DATABASE_MUTATIONS: '1',
  E2E_DISPOSABLE_DB_PREFLIGHT_CONFIRMED: '1',
  SUPABASE_TEST_URL: 'http://127.0.0.1:55321',
  SUPABASE_TEST_ANON_KEY: 'unit-test-anon-key',
  SUPABASE_TEST_SERVICE_ROLE_KEY: 'unit-test-service-key',
};

function e2eSpecs(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return e2eSpecs(entryPath);
    return entry.isFile() && entry.name.endsWith('.spec.ts') ? [entryPath] : [];
  });
}

describe('isolated Playwright database target guard', () => {
  it('requires explicit mutation opt-in', () => {
    const { E2E_ALLOW_DATABASE_MUTATIONS: _optIn, ...withoutOptIn } = validTarget;
    expect(() => resolveIsolatedE2EDatabaseConfig(withoutOptIn)).toThrow(
      'E2E_ALLOW_DATABASE_MUTATIONS'
    );
  });

  it('requires the documented operator preflight confirmation', () => {
    const { E2E_DISPOSABLE_DB_PREFLIGHT_CONFIRMED: _preflight, ...withoutPreflight } = validTarget;
    expect(() => resolveIsolatedE2EDatabaseConfig(withoutPreflight)).toThrow(
      'E2E_DISPOSABLE_DB_PREFLIGHT_CONFIRMED'
    );
  });

  it('requires an explicit test URL', () => {
    const { SUPABASE_TEST_URL: _url, ...withoutUrl } = validTarget;
    expect(() => resolveIsolatedE2EDatabaseConfig(withoutUrl)).toThrow('SUPABASE_TEST_URL');
  });

  it('rejects the original V4 API port', () => {
    expect(() => resolveIsolatedE2EDatabaseConfig({
      ...validTarget,
      SUPABASE_TEST_URL: 'http://127.0.0.1:54321',
    })).toThrow('SUPABASE_TEST_URL');
  });

  it('rejects every unexpected API port', () => {
    expect(() => resolveIsolatedE2EDatabaseConfig({
      ...validTarget,
      SUPABASE_TEST_URL: 'http://127.0.0.1:55322',
    })).toThrow('SUPABASE_TEST_URL');
  });

  it('accepts an explicitly opted-in disposable loopback IP on port 55321', () => {
    expect(resolveIsolatedE2EDatabaseConfig(validTarget)).toEqual({
      url: 'http://127.0.0.1:55321',
      anonKey: 'unit-test-anon-key',
      serviceRoleKey: 'unit-test-service-key',
    });
  });

  it('accepts IPv6 loopback on the approved port', () => {
    expect(resolveIsolatedE2EDatabaseConfig({
      ...validTarget,
      SUPABASE_TEST_URL: 'http://[::1]:55321',
    }).url).toBe('http://[::1]:55321');
  });

  it('rejects hostnames, including localhost, because an IP literal is required', () => {
    for (const url of [
      'https://remote.example:55321',
      'http://localhost:55321',
      'http://2130706433:55321',
    ]) {
      expect(() => resolveIsolatedE2EDatabaseConfig({ ...validTarget, SUPABASE_TEST_URL: url }))
        .toThrow('SUPABASE_TEST_URL');
    }
  });

  it('rejects malformed URLs without echoing supplied values', () => {
    const malformed = 'not-a-url-with-sensitive-looking-content';
    try {
      resolveIsolatedE2EDatabaseConfig({ ...validTarget, SUPABASE_TEST_URL: malformed });
      throw new Error('Expected target validation to fail.');
    } catch (error) {
      expect(String(error)).toContain('SUPABASE_TEST_URL');
      expect(String(error)).not.toContain(malformed);
    }
  });

  it('rejects incomplete test credentials by variable name only', () => {
    const { SUPABASE_TEST_SERVICE_ROLE_KEY: _serviceKey, ...incomplete } = validTarget;
    expect(() => resolveIsolatedE2EDatabaseConfig(incomplete)).toThrow(
      'SUPABASE_TEST_SERVICE_ROLE_KEY'
    );
  });

  it('guards every Playwright spec before test-module client construction', () => {
    const specs = e2eSpecs(path.resolve(process.cwd(), 'src/test/e2e'));
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(fs.readFileSync(spec, 'utf8'), path.basename(spec)).toContain('e2e-target-guard');
    }
  });

  it('loads the guard before building/starting an isolated server and does not reuse an existing server', () => {
    const config = fs.readFileSync(path.resolve(process.cwd(), 'playwright.config.ts'), 'utf8');
    expect(config.indexOf('e2e-target-guard')).toBeLessThan(config.indexOf('export default'));
    expect(config).toContain('node scripts/check-port.js && npm run build && node scripts/start-prod.js');
    expect(config).toContain('reuseExistingServer: false');
    expect(config).not.toContain("dotenv.config({ path: '.env.local' })");
  });

  it('contains no known port-54321 fallback in E2E setup or specs', () => {
    const files = [...e2eSpecs(path.resolve(process.cwd(), 'src/test/e2e')),
      path.resolve(process.cwd(), 'src/test/e2e/setup/auction-fixture.ts')];
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8'), path.basename(file)).not.toContain('127.0.0.1:54321');
    }
  });

  it('does not load project dotenv files in Playwright specs or setup', () => {
    const files = [...e2eSpecs(path.resolve(process.cwd(), 'src/test/e2e')),
      path.resolve(process.cwd(), 'src/test/e2e/setup/auction-fixture.ts')];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source, path.basename(file)).not.toMatch(/dotenv\.config|from ['"]dotenv['"]/);
    }
  });

  it('maps only the validated test settings to application client variable names', () => {
    const guard = fs.readFileSync(
      path.resolve(process.cwd(), 'src/test/e2e/setup/e2e-target-guard.ts'),
      'utf8'
    );
    expect(guard).toContain('resolveIsolatedE2EDatabaseConfig(process.env)');
    expect(guard).toContain('process.env.NEXT_PUBLIC_SUPABASE_URL = target.url');
    expect(guard).toContain('process.env.SUPABASE_SERVICE_ROLE_KEY = target.serviceRoleKey');
    expect(guard).not.toMatch(/console\.(log|info|debug).*target\.(anonKey|serviceRoleKey)/);
  });
});
