const net = require('net');

const port = 3000;
const hosts = ['0.0.0.0', '127.0.0.1', '::', '::1'];

function checkHost(host) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true); // Port is in use
      } else {
        // Ignore other errors (e.g. IPv6 not supported)
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(false); // Port is free on this host
      });
    });

    server.listen(port, host);
  });
}

async function checkPort() {
  let inUse = false;
  for (const host of hosts) {
    const used = await checkHost(host);
    if (used) {
      inUse = true;
      break;
    }
  }

  if (inUse) {
    console.error(`\n[ERROR] PORT ${port} IS ALREADY IN USE.`);
    console.error(`Next.js development server must run on port ${port}.`);
    console.error(`Please kill the process using this port and try again.\n`);
    process.exit(1);
  } else {
    process.exit(0);
  }
}

checkPort();
