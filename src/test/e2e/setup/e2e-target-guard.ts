import { resolveIsolatedE2EDatabaseConfig } from '../../database/runtime-test-config';

// This module is imported by Playwright config and every E2E spec/fixture that
// can mutate data. It validates before any test module constructs a client.
const target = resolveIsolatedE2EDatabaseConfig(process.env);

// Existing application code uses these names. Populate them only after the
// test-only target guard succeeds so app/server clients cannot inherit a
// project URL or key from ambient configuration.
process.env.NEXT_PUBLIC_SUPABASE_URL = target.url;
process.env.SUPABASE_URL = target.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = target.anonKey;
process.env.SUPABASE_ANON_KEY = target.anonKey;
process.env.SUPABASE_SERVICE_ROLE_KEY = target.serviceRoleKey;
// A local-only credential for the Playwright webServer's protected tick route.
// The test app is bound to the guarded disposable Supabase target above.
process.env.AUCTION_TICK_SECRET = 'human-only-e2e-tick-secret-'.padEnd(48, 'x');
