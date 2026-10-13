// scripts/auction-ticker.js
// Runs a local interval loop to trigger the Next.js API route tick endpoint.
// This decouples the authoritative auction lifecycle from the browser.

const TICK_INTERVAL_MS = 2000;
const ENDPOINTS = [
  'http://[::1]:3000/api/auction/tick',
  'http://127.0.0.1:3000/api/auction/tick'
];

console.log(`[AUCTION TICKER] Starting local ticker. Pinging API every ${TICK_INTERVAL_MS}ms...`);

setInterval(async () => {
  let success = false;
  let lastErr = null;

  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      success = true;
      if (res.ok) {
        const data = await res.json();
        if (data.actions && data.actions.length > 0) {
          console.log(`[AUCTION TICKER] Actions taken:`, data.actions);
        }
      } else {
        console.error(`[AUCTION TICKER] Error response: ${res.status} ${res.statusText}`);
      }
      break; // Stop after a successful connection
    } catch (err) {
      lastErr = err;
    }
  }

  if (!success) {
    console.error(`[AUCTION TICKER] Connection failed:`);
    console.error(lastErr?.message || lastErr);
    if (lastErr?.code) console.error(`Code: ${lastErr.code}`);
    if (lastErr?.cause) console.error(`Cause:`, lastErr.cause);
  }
}, TICK_INTERVAL_MS);
