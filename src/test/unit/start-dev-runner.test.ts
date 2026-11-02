import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const {
  StartupReadinessError,
  waitForTickRouteReady,
  terminateProcessTree,
  runDevRunner,
} = require('../../../scripts/start-dev.js') as typeof import('../../../scripts/start-dev.js');

class FakeChild extends EventEmitter {
  pid = 1234;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;

  kill() {
    this.killed = true;
    this.exitCode = 0;
    this.emit('close', 0, null);
    return true;
  }
}

describe('development worker startup and shutdown', () => {
  it('waits for the unauthenticated GET route probe to return Next.js 405', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 405 }));
    const wait = vi.fn(async () => undefined);

    await expect(waitForTickRouteReady({ fetchImpl, wait, timeoutMs: 5_000 })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(url).toBe('http://localhost:3000/api/auction/tick');
      expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'manual' });
      expect(init.headers).toBeUndefined();
    }
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('bounds readiness retries and fails closed when the route never becomes ready', async () => {
    let clock = 0;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const wait = vi.fn(async (ms: number) => { clock += ms; });

    await expect(waitForTickRouteReady({
      fetchImpl,
      wait,
      now: () => clock,
      timeoutMs: 1_000,
      pollMs: 500,
    })).rejects.toBeInstanceOf(StartupReadinessError);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry authentication or other unexpected HTTP responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const wait = vi.fn();

    await expect(waitForTickRouteReady({ fetchImpl, wait })).rejects.toThrow('unexpected HTTP 401');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it('does not start the worker until the tick route readiness probe succeeds', async () => {
    const next = new FakeChild();
    const worker = new FakeChild();
    const children = [next, worker];
    const spawnImpl = vi.fn(() => children.shift()!);
    const processRef = new EventEmitter();
    let releaseProbe!: (response: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { releaseProbe = resolve; }));
    const run = runDevRunner({
      platform: 'linux',
      spawnImpl,
      processRef,
      log: { log: vi.fn() },
      readiness: { fetchImpl },
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    expect(spawnImpl).toHaveBeenCalledOnce();
    expect(spawnImpl).toHaveBeenNthCalledWith(1, process.execPath,
      [expect.stringContaining('next'), 'dev', '--disable-source-maps', '-p', '3000'],
      { stdio: 'inherit', windowsHide: true });

    releaseProbe(new Response(null, { status: 405 }));
    await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(2));
    expect(spawnImpl).toHaveBeenNthCalledWith(2, process.execPath,
      [expect.stringContaining('tsx'), 'scripts/worker.ts'],
      { stdio: 'inherit', windowsHide: true });
    worker.exitCode = 1;
    worker.emit('exit', 1, null);

    await expect(run).resolves.toBe(1);
    expect(next.killed).toBe(true);
  });

  it('waits for Windows taskkill to finish and targets the entire child tree', async () => {
    const child = new FakeChild();
    const taskkill = new EventEmitter();
    const spawnImpl = vi.fn(() => taskkill);

    let completed = false;
    const stopping = terminateProcessTree(child, { platform: 'win32', spawnImpl })
      .then(() => { completed = true; });

    expect(spawnImpl).toHaveBeenCalledWith('taskkill', ['/pid', '1234', '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    taskkill.emit('close', 0);
    await stopping;
    expect(completed).toBe(true);
    expect(child.killed).toBe(false);
  });
});
