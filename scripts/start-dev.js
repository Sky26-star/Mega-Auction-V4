const { spawn } = require('child_process');

console.log('[DEV-RUNNER] Starting Next.js and Auction Ticker concurrently...');

const isWindows = /^win/.test(process.platform);
const npxCmd = isWindows ? 'npx.cmd' : 'npx';
const nodeCmd = process.execPath;

// Start Next.js
const nextProcess = spawn(npxCmd, ['next', 'dev', '-p', '3000'], {
  stdio: 'inherit',
  shell: isWindows
});

// Start Auction Ticker
const tickerProcess = spawn(nodeCmd, ['scripts/auction-ticker.js'], {
  stdio: 'inherit',
  shell: false
});

// Handle graceful termination
function handleKill(signal) {
  console.log(`\n[DEV-RUNNER] Received ${signal}. Terminating child processes...`);
  
  if (nextProcess && !nextProcess.killed) {
    if (isWindows) {
      spawn('taskkill', ['/pid', nextProcess.pid, '/f', '/t']);
    } else {
      nextProcess.kill(signal);
    }
  }
  
  if (tickerProcess && !tickerProcess.killed) {
    if (isWindows) {
      spawn('taskkill', ['/pid', tickerProcess.pid, '/f', '/t']);
    } else {
      tickerProcess.kill(signal);
    }
  }
  
  process.exit(0);
}

process.on('SIGINT', () => handleKill('SIGINT'));
process.on('SIGTERM', () => handleKill('SIGTERM'));

nextProcess.on('exit', (code) => {
  console.log(`[DEV-RUNNER] Next.js exited with code ${code}.`);
  if (!tickerProcess.killed) {
    if (isWindows) spawn('taskkill', ['/pid', tickerProcess.pid, '/f', '/t']);
    else tickerProcess.kill('SIGINT');
  }
  process.exit(code || 0);
});

tickerProcess.on('exit', (code) => {
  console.log(`[DEV-RUNNER] Auction ticker exited with code ${code}.`);
  if (!nextProcess.killed) {
    if (isWindows) spawn('taskkill', ['/pid', nextProcess.pid, '/f', '/t']);
    else nextProcess.kill('SIGINT');
  }
  process.exit(code || 0);
});
