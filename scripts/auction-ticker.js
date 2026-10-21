// [DEPRECATED] scripts/auction-ticker.js
// This legacy runner forwards directly to the authoritative background worker.
// The production and Dockerfile entrypoint is: npm run worker (scripts/worker.ts)
const { spawn } = require('child_process');

console.log('[AUCTION TICKER] [NOTICE] scripts/auction-ticker.js is deprecated. Forwarding to authoritative worker (npm run worker)...');

const isWindows = /^win/.test(process.platform);
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

const child = spawn(npmCmd, ['run', 'worker'], {
  stdio: 'inherit',
  shell: isWindows,
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

function forwardSignal(sig) {
  if (child && !child.killed) {
    if (isWindows) {
      spawn('taskkill', ['/pid', child.pid, '/f', '/t']);
    } else {
      child.kill(sig);
    }
  }
}

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));
