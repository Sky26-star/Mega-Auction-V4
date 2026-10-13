import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createAdminClient } from '../src/lib/supabase/admin';
import { executeAuctionTick } from '../src/lib/auction/auction-orchestrator';

// Phase 15 - Worker configuration
const TARGET_INTERVAL_MS = 500;
let isRunning = true;
let currentTickPromise: Promise<void> | null = null;

/**
 * Deterministic error classifier for tick failures.
 * Only explicit networking, timeout, and definitively known transient Postgres errors
 * are considered recoverable. All other errors (including ENOTFOUND, ECONNREFUSED,
 * syntax errors, invalid logic) are fatal to avoid infinite 500ms retry loops on
 * persistent configuration/schema failures.
 */
function isRecoverableTickError(err: any): boolean {
  if (!err) return false;

  // 1. Node.js native fetch / networking errors
  if (err instanceof TypeError && err.message && err.message.includes('fetch failed')) {
    return true;
  }

  // 2. Definitively Transient Node system network error codes
  // Excludes ENOTFOUND, ECONNREFUSED, EHOSTUNREACH which often indicate persistent misconfiguration
  const transientNetworkCodes = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'];
  if (err.code && transientNetworkCodes.includes(err.code)) {
    return true;
  }

  // 3. Definitively Transient Postgres SQLSTATE codes
  if (typeof err.code === 'string' && err.code.length === 5) {
    const transientSqlStates = [
      '40001', // serialization_failure
      '40P01', // deadlock_detected
      '53300', // too_many_connections
      '53000', // insufficient_resources
      '57014', // query_canceled (e.g. statement timeout)
      '57P01', // admin_shutdown
      '57P02', // crash_shutdown
      '57P03', // cannot_connect_now
      '08000', // connection_exception
      '08003', // connection_does_not_exist
      '08006'  // connection_failure
    ];
    if (transientSqlStates.includes(err.code)) {
      return true;
    }
  }

  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorker() {
  console.log('[WORKER] Starting Persistent Auction Worker...');
  
  let supabase;
  try {
    supabase = createAdminClient();
    console.log('[WORKER] Supabase admin client initialized.');
  } catch (err: any) {
    console.error('[WORKER] FATAL INITIALIZATION ERROR:', err.message || err);
    process.exit(1);
  }

  console.log(`[WORKER] Entering serialized loop. Target cadence: ${TARGET_INTERVAL_MS}ms`);

  while (isRunning) {
    const start = Date.now();
    let tickError = null;

    currentTickPromise = (async () => {
      try {
        await executeAuctionTick(supabase);
      } catch (err: any) {
        tickError = err;
      }
    })();

    await currentTickPromise;
    currentTickPromise = null;

    if (tickError) {
      if (isRecoverableTickError(tickError)) {
        console.error('[WORKER] TICK TRANSIENT ERROR:', tickError);
      } else {
        console.error('[WORKER] FATAL TICK ERROR:', tickError);
        console.error('[WORKER] Terminating due to unknown/fatal tick error.');
        process.exit(1);
      }
    }

    const elapsed = Date.now() - start;
    const delay = Math.max(0, TARGET_INTERVAL_MS - elapsed);
    
    // Only sleep if we're still meant to be running, to allow immediate shutdown
    if (isRunning && delay > 0) {
      await sleep(delay);
    }
  }

  console.log('[WORKER] Loop terminated safely.');
}

async function shutdown(signal: string) {
  console.log(`\n[WORKER] Received ${signal}. Initiating graceful shutdown...`);
  isRunning = false;

  if (currentTickPromise) {
    console.log('[WORKER] Waiting for current tick to finish...');
    await currentTickPromise;
  }

  console.log('[WORKER] Graceful shutdown complete. Exiting.');
  process.exit(0);
}

// Register handlers for graceful shutdown
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start the worker
runWorker().catch(err => {
  console.error('[WORKER] UNEXPECTED FATAL ERROR:', err);
  process.exit(1);
});
