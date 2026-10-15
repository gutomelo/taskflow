import { pino } from 'pino';
import request from 'supertest';
import type { DependencyProbe } from '@taskflow/backend/shared/infrastructure';
import { problemDetailsSchema, readinessReportSchema } from '@taskflow/contracts';
import { createApp } from './app';

const silentLogger = pino({ level: 'silent' });

function buildApp(probes: DependencyProbe[] = []) {
  return createApp({
    config: { trustProxy: false, jsonBodyLimit: '1kb', healthCheckTimeoutMs: 100 },
    logger: silentLogger,
    probes,
  });
}

const upProbe = (name: string): DependencyProbe => ({ name, check: async () => undefined });
const downProbe = (name: string): DependencyProbe => ({
  name,
  check: async () => {
    throw new Error('ECONNREFUSED 10.0.0.12:5432');
  },
});

describe('API foundation', () => {
  describe('GET /health/live', () => {
    it('responds ok without checking dependencies', async () => {
      const response = await request(buildApp([downProbe('postgres')])).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /health/ready', () => {
    it('responds 200 when every dependency is up', async () => {
      const response = await request(buildApp([upProbe('postgres'), upProbe('redis')])).get(
        '/health/ready',
      );

      expect(response.status).toBe(200);
      expect(readinessReportSchema.parse(response.body).status).toBe('ready');
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('responds 503 without leaking internal error details when a dependency is down', async () => {
      const response = await request(buildApp([upProbe('postgres'), downProbe('redis')])).get(
        '/health/ready',
      );

      expect(response.status).toBe(503);
      const report = readinessReportSchema.parse(response.body);
      expect(report.status).toBe('not_ready');
      expect(report.checks.find((check) => check.name === 'redis')?.status).toBe('down');
      expect(response.text).not.toContain('ECONNREFUSED');
    });
  });

  describe('errors', () => {
    it('returns Problem Details with the request id for unknown routes', async () => {
      const response = await request(buildApp()).get('/api/v1/unknown');

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
      const problem = problemDetailsSchema.parse(response.body);
      expect(problem.code).toBe('ROUTE_NOT_FOUND');
      expect(problem.requestId).toBe(response.headers['x-request-id']);
    });

    it('rejects payloads above the configured limit with 413', async () => {
      const response = await request(buildApp())
        .post('/health/live')
        .set('content-type', 'application/json')
        .send(JSON.stringify({ data: 'x'.repeat(2048) }));

      expect(response.status).toBe(413);
      expect(problemDetailsSchema.parse(response.body).code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('rejects malformed JSON with 400', async () => {
      const response = await request(buildApp())
        .post('/health/live')
        .set('content-type', 'application/json')
        .send('{"broken":');

      expect(response.status).toBe(400);
      expect(problemDetailsSchema.parse(response.body).code).toBe('MALFORMED_JSON');
    });
  });

  describe('request id and security headers', () => {
    it('echoes a valid incoming x-request-id', async () => {
      const response = await request(buildApp())
        .get('/health/live')
        .set('x-request-id', 'trace-abc_123');

      expect(response.headers['x-request-id']).toBe('trace-abc_123');
    });

    it('replaces an unsafe incoming x-request-id with a generated UUID', async () => {
      const response = await request(buildApp())
        .get('/health/live')
        .set('x-request-id', 'bad id\twith spaces');

      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('sets security headers and hides the framework', async () => {
      const response = await request(buildApp()).get('/health/live');

      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toBeDefined();
    });
  });
});
