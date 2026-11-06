// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AuctionTickHttpError, requestAuctionTick } from '@/lib/auction/tick-client';
import { tickResult } from '@/lib/auction/tick-result';

const servers: Server[] = [];
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  })));
});

describe('real HTTP tick transport (synthetic credentials, loopback only)', () => {
  it.each([301, 302, 303, 307, 308])('does not forward either credential on HTTP %i', async status => {
    let destinationRequests = 0;
    const destination = await listen(createServer((_request, response) => {
      destinationRequests++;
      response.end('unexpected redirect follow');
    }));
    let originCredentials: string[] = [];
    const origin = await listen(createServer((request, response) => {
      originCredentials = [String(request.headers['x-auction-tick-secret']), String(request.headers['x-vercel-protection-bypass'])];
      response.writeHead(status, { location: destination });
      response.end();
    }));
    // Direct configuration is deliberate: production configuration rejects
    // loopback bypass credentials. These values are test-only sentinels.
    await expect(requestAuctionTick({ url: `${origin}/api/auction/tick`,
      secret: 'synthetic-auction-secret', vercelBypassSecret: 'synthetic-bypass-secret' }))
      .rejects.toThrow(`HTTP ${status}`);
    expect(originCredentials).toEqual(['synthetic-auction-secret', 'synthetic-bypass-secret']);
    expect(destinationRequests).toBe(0);
  });

  it('preserves completed and failed action outcomes from a real HTTP 503', async () => {
    const result = tickResult([
      { action: 'FINALIZE_LOT', status: 'succeeded', lot: 'lot-1' },
      { action: 'RESUME_AUCTION', status: 'failed', auction: 'auction-2' },
    ]);
    const origin = await listen(createServer((_request, response) => {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
    }));
    const error = await requestAuctionTick({ url: `${origin}/api/auction/tick`, secret: 'synthetic-secret' }).catch(e => e);
    expect(error).toBeInstanceOf(AuctionTickHttpError);
    expect(error.result).toEqual(result);
    expect(JSON.stringify(error)).not.toContain('lot-1');
    expect(error.message).not.toContain('auction-2');
  });

  it('bounds untrusted error bodies and keeps malformed output out of errors', async () => {
    const origin = await listen(createServer((_request, response) => {
      response.writeHead(500);
      response.end('x'.repeat(70_000));
    }));
    const error = await requestAuctionTick({ url: `${origin}/api/auction/tick`, secret: 'synthetic-secret' }).catch(e => e);
    expect(error).toBeInstanceOf(AuctionTickHttpError);
    expect(error.result).toBeUndefined();
    expect(error.message).toBe('Authenticated auction tick failed with HTTP 500.');
  });

  it.each([401, 403, 500])('preserves HTTP %i without exposing HTML as an outcome', async status => {
    const origin = await listen(createServer((_request, response) => {
      response.writeHead(status, { 'content-type': 'text/html' });
      response.end('<html>private login content</html>');
    }));
    const error = await requestAuctionTick({ url: `${origin}/api/auction/tick`, secret: 'synthetic-secret' }).catch(e => e);
    expect(error.status).toBe(status);
    expect(error.result).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('private login content');
  });

  it('applies the request deadline while an error response body stalls', async () => {
    const origin = await listen(createServer((_request, response) => {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.write('{');
      // Intentionally unfinished; afterEach closes this test-owned socket.
    }));
    await expect(requestAuctionTick({ url: `${origin}/api/auction/tick`, secret: 'synthetic-secret' },
      fetch, { timeoutMs: 150 })).rejects.toMatchObject({ name: 'AuctionTickTimeoutError' });
  });
});
