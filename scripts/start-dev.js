'use strict';

const { spawn } = require('child_process');

const TICK_ENDPOINT = 'http://localhost:3000/api/auction/tick';
const STARTUP_TIMEOUT_MS = 90_000;
const STARTUP_POLL_MS = 500;
const STARTUP_REQUEST_TIMEOUT_MS = 1_000;
const TEMPORARY_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

class StartupReadinessError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'StartupReadinessError';
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function networkCode(error) {
  let current = error;
  const visited = new Set();
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if (typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return undefined;
}

function isTemporaryStartupFailure(error) {
  const code = networkCode(error);
  if (code && TEMPORARY_NETWORK_CODES.has(code)) return true;
  // Node's fetch wraps connection failures as TypeError("fetch failed").
  // Retry it only during this bounded local readiness check.
  return error instanceof TypeError && error.message === 'fetch failed';
}

async function probeTickRoute(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForTickRouteReady(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const url = options.url || TICK_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? STARTUP_TIMEOUT_MS;
  const pollMs = options.pollMs ?? STARTUP_POLL_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? STARTUP_REQUEST_TIMEOUT_MS;
  const now = options.now || Date.now;
  const waitImpl = options.wait || wait;
  const deadline = now() + timeoutMs;
  let lastStatus;
  let lastError;

  while (now() < deadline) {
    try {
      const response = await probeTickRoute(fetchImpl, url, requestTimeoutMs);
      lastStatus = response.status;
      if (response.status === 405) {
        await response.body?.cancel().catch(() => undefined);
        return;
      }

      await response.body?.cancel().catch(() => undefined);
      if (response.status !== 404 && response.status < 500) {
        throw new StartupReadinessError(
          `Tick route readiness check returned unexpected HTTP ${response.status}.`
        );
      }
    } catch (error) {
      if (error instanceof StartupReadinessError) throw error;
      if (!isTemporaryStartupFailure(error) && error?.name !== 'AbortError') throw error;
      lastError = error;
    }

    const remainingMs = deadline - now();
    if (remainingMs > 0) await waitImpl(Math.min(pollMs, remainingMs));
  }

  const detail = lastStatus ? ` Last HTTP status: ${lastStatus}.` : '';
  const cause = lastError ? ` Last network error: ${lastError.message}.` : '';
  throw new StartupReadinessError(
    `Next.js tick route did not become ready within ${timeoutMs}ms.${detail}${cause}`,
    lastError ? { cause: lastError } : undefined
  );
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForChildClose(child, timeoutMs = 5_000) {
  if (childHasExited(child)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, timeoutMs);
    function finish() {
      clearTimeout(timer);
      child.removeListener?.('close', finish);
      resolve();
    }
    child.once?.('close', finish);
  });
}

async function terminateProcessTree(child, options = {}) {
  if (!child || childHasExited(child)) return;
  const platform = options.platform || process.platform;
  const spawnImpl = options.spawnImpl || spawn;
  const signal = options.signal || 'SIGTERM';

  if (platform === 'win32') {
    if (!child.pid) {
      child.kill?.();
      return;
    }

    try {
      const killer = spawnImpl('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      const result = await new Promise((resolve, reject) => {
        killer.once('error', reject);
        killer.once('close', (code) => resolve(code));
      });
      if (result === 0 || childHasExited(child)) return;
    } catch {
      // Fall back to the direct child if taskkill cannot be launched.
    }

    child.kill?.();
    await waitForChildClose(child);
    return;
  }

  child.kill?.(signal);
  await waitForChildClose(child);
}

function childOutcome(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function normalizedExitCode(outcome) {
  return typeof outcome.code === 'number' ? outcome.code : outcome.signal ? 1 : 0;
}

async function runDevRunner(options = {}) {
  const platform = options.platform || process.platform;
  const spawnImpl = options.spawnImpl || spawn;
  const processRef = options.processRef || process;
  const log = options.log || console;
  const nodeExecutable = options.execPath || process.execPath;
  const nextProcess = spawnImpl(nodeExecutable, [require.resolve('next/dist/bin/next'), 'dev', '--disable-source-maps', '-p', '3000'], {
    stdio: 'inherit',
    windowsHide: true,
  });
  const nextOutcome = childOutcome(nextProcess);
  let tickerProcess;
  let tickerOutcome;
  let stopping = false;
  const signalHandlers = {};

  log.log('[DEV-RUNNER] Waiting for the Next.js auction tick route to become ready...');

  const signalPromise = new Promise((resolve) => {
    const onSignal = (signal) => {
      if (stopping) return;
      stopping = true;
      log.log(`\n[DEV-RUNNER] Received ${signal}. Terminating child process trees...`);
      void Promise.all([
        terminateProcessTree(nextProcess, { platform, spawnImpl, signal }),
        terminateProcessTree(tickerProcess, { platform, spawnImpl, signal }),
      ]).finally(() => resolve({ code: 0, signal, handledByRunner: true }));
    };
    signalHandlers.SIGINT = () => onSignal('SIGINT');
    signalHandlers.SIGTERM = () => onSignal('SIGTERM');
    processRef.on('SIGINT', signalHandlers.SIGINT);
    processRef.on('SIGTERM', signalHandlers.SIGTERM);
  });

  try {
    const readiness = waitForTickRouteReady(options.readiness);
    const first = await Promise.race([
      readiness.then(() => ({ ready: true })),
      nextOutcome.then((outcome) => ({ outcome })),
      signalPromise.then((outcome) => ({ outcome })),
    ]);

    if (first.outcome) {
      await terminateProcessTree(tickerProcess, { platform, spawnImpl });
      return normalizedExitCode(first.outcome);
    }

    log.log('[DEV-RUNNER] Next.js tick route is ready; starting the serialized auction worker.');
    tickerProcess = spawnImpl(nodeExecutable, [require.resolve('tsx/cli'), 'scripts/worker.ts'], {
      stdio: 'inherit',
      windowsHide: true,
    });
    tickerOutcome = childOutcome(tickerProcess);

    const outcome = await Promise.race([
      nextOutcome,
      tickerOutcome,
      signalPromise,
    ]);

    stopping = true;
    if (!outcome.handledByRunner) {
      await Promise.all([
        terminateProcessTree(nextProcess, { platform, spawnImpl }),
        terminateProcessTree(tickerProcess, { platform, spawnImpl }),
      ]);
    }
    return normalizedExitCode(outcome);
  } catch (error) {
    stopping = true;
    await Promise.all([
      terminateProcessTree(nextProcess, { platform, spawnImpl }),
      terminateProcessTree(tickerProcess, { platform, spawnImpl }),
    ]);
    throw error;
  } finally {
    processRef.removeListener?.('SIGINT', signalHandlers.SIGINT);
    processRef.removeListener?.('SIGTERM', signalHandlers.SIGTERM);
    // Avoid an unhandled rejection if a child emits an error after its peer exits.
    void nextOutcome.catch(() => undefined);
    void tickerOutcome?.catch(() => undefined);
  }
}

module.exports = {
  StartupReadinessError,
  waitForTickRouteReady,
  terminateProcessTree,
  runDevRunner,
};

if (require.main === module) {
  runDevRunner().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`[DEV-RUNNER] FATAL STARTUP ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
