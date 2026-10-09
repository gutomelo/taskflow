import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { pino } from 'pino';
import type { DependencyProbe } from '@taskflow/backend/shared/infrastructure';
import { createHealthServer } from './health-server';

const healthyProbe = (name: string): DependencyProbe => ({ name, check: async () => undefined });
const failingProbe = (name: string): DependencyProbe => ({
  name,
  check: async () => {
    throw new Error('connection refused to postgres://user:secret@db');
  },
});

describe('worker health server', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function start(probes: ReadonlyArray<DependencyProbe>): Promise<string> {
    server = createHealthServer({ probes, timeoutMs: 100, logger: pino({ level: 'silent' }) });
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    const { port } = listening.address() as AddressInfo; // listen() em TCP sempre devolve AddressInfo
    return `http://127.0.0.1:${port}`;
  }

  it('reports liveness without checking dependencies', async () => {
    const baseUrl = await start([failingProbe('postgres')]);

    const response = await fetch(`${baseUrl}/health/live`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('is ready when every dependency is up', async () => {
    const baseUrl = await start([healthyProbe('postgres'), healthyProbe('redis')]);

    const response = await fetch(`${baseUrl}/health/ready`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ready',
      checks: [
        { name: 'postgres', status: 'up' },
        { name: 'redis', status: 'up' },
      ],
    });
  });

  it('answers 503 without leaking error details when a dependency is down', async () => {
    const baseUrl = await start([healthyProbe('postgres'), failingProbe('redis')]);

    const response = await fetch(`${baseUrl}/health/ready`);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toMatchObject({
      status: 'not_ready',
      checks: [
        { name: 'postgres', status: 'up' },
        { name: 'redis', status: 'down' },
      ],
    });
    expect(body).not.toContain('secret');
  });

  it('ignores the query string when routing', async () => {
    const baseUrl = await start([]);

    expect((await fetch(`${baseUrl}/health/live?probe=k8s`)).status).toBe(200);
  });

  it('answers 404 for unknown paths', async () => {
    const baseUrl = await start([]);

    expect((await fetch(`${baseUrl}/health`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/v1/auth/login`)).status).toBe(404);
  });

  it('answers 405 for non-GET methods', async () => {
    const baseUrl = await start([]);

    const response = await fetch(`${baseUrl}/health/live`, { method: 'POST' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});
