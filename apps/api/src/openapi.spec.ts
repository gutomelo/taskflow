import { validate } from '@readme/openapi-parser';
import { pino } from 'pino';
import request from 'supertest';
import { createApp } from './app';
import { createTaskflowApiDocument } from './openapi';

const IDENTITY_ROUTES = [
  ['get', '/api/v1/auth/csrf'],
  ['post', '/api/v1/auth/register'],
  ['post', '/api/v1/auth/login'],
  ['post', '/api/v1/auth/refresh'],
  ['post', '/api/v1/auth/logout'],
  ['post', '/api/v1/auth/email-verification/resend'],
  ['post', '/api/v1/auth/email-verification/confirm'],
  ['post', '/api/v1/auth/password/forgot'],
  ['post', '/api/v1/auth/password/reset'],
  ['get', '/api/v1/me'],
  ['post', '/api/v1/me/password'],
  ['get', '/api/v1/me/sessions'],
  ['delete', '/api/v1/me/sessions/{sessionId}'],
] as const;

describe('OpenAPI document (RF-14, CA-15)', () => {
  const document = createTaskflowApiDocument();

  it('CA-15: is a valid OpenAPI 3.1 document', async () => {
    const result = await validate(structuredClone(JSON.parse(JSON.stringify(document))));

    expect(result.valid ? [] : result.errors).toEqual([]);
    expect(document.openapi).toBe('3.1.0');
  });

  it('CA-15: describes every identity endpoint of spec 001', () => {
    const paths = document.paths ?? {};

    for (const [method, path] of IDENTITY_ROUTES) {
      expect(paths[path]?.[method], `${method.toUpperCase()} ${path}`).toBeDefined();
    }
  });

  it('documents errors as Problem Details and cookie/CSRF security schemes', () => {
    const login = document.paths?.['/api/v1/auth/login']?.post;

    expect(Object.keys(login?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '401', '403', '429']),
    );
    expect(JSON.stringify(login?.responses?.['401'])).toContain('application/problem+json');
    expect(document.components?.securitySchemes).toMatchObject({
      sessionCookie: { type: 'apiKey', in: 'cookie', name: '__Host-tf_at' },
      csrfToken: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
    });
  });

  it('serves the document and the Swagger UI without inline scripts (CSP-safe)', async () => {
    const app = createApp({
      config: { trustProxy: false, jsonBodyLimit: '100kb', healthCheckTimeoutMs: 100 },
      logger: pino({ level: 'silent' }),
      probes: [],
      apiDocument: document,
    });

    const json = await request(app).get('/api/docs/openapi.json').expect(200);
    const page = await request(app).get('/api/docs/').expect(200);
    await request(app).get('/api/docs/assets/swagger-ui-bundle.js').expect(200);
    await request(app).get('/api/docs/swagger-initializer.js').expect(200);

    expect(json.body.openapi).toBe('3.1.0');
    expect(page.text).not.toMatch(/<script>(?!<\/script>)/);
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
  });

  it('is absent when no document is provided (production)', async () => {
    const app = createApp({
      config: { trustProxy: false, jsonBodyLimit: '100kb', healthCheckTimeoutMs: 100 },
      logger: pino({ level: 'silent' }),
      probes: [],
    });

    await request(app).get('/api/docs/openapi.json').expect(404);
  });
});
