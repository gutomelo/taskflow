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

/** Spec 002 (T15): rotas fora do tenant e sob o prefixo `/organizations/{organizationId}`. */
const ORGANIZATIONS_ROUTES = [
  ['post', '/api/v1/organizations'],
  ['get', '/api/v1/me/organizations'],
  ['post', '/api/v1/invitations/lookup'],
  ['post', '/api/v1/invitations/accept'],
  ['get', '/api/v1/organizations/{organizationId}'],
  ['patch', '/api/v1/organizations/{organizationId}'],
  ['get', '/api/v1/organizations/{organizationId}/members'],
  ['patch', '/api/v1/organizations/{organizationId}/members/{userId}'],
  ['delete', '/api/v1/organizations/{organizationId}/members/{userId}'],
  ['get', '/api/v1/organizations/{organizationId}/invitations'],
  ['post', '/api/v1/organizations/{organizationId}/invitations'],
  ['post', '/api/v1/organizations/{organizationId}/invitations/{invitationId}/resend'],
  ['delete', '/api/v1/organizations/{organizationId}/invitations/{invitationId}'],
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

  it('T15: describes every organizations endpoint of spec 002, with 404 for non-members', () => {
    const paths = document.paths ?? {};

    for (const [method, path] of ORGANIZATIONS_ROUTES) {
      const operation = paths[path]?.[method];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      if (path.includes('{organizationId}')) {
        expect(Object.keys(operation?.responses ?? {}), `${method} ${path}`).toContain('404');
      }
    }
    expect(
      Object.keys(paths).filter(
        (path) =>
          path.includes('organizations') && !path.includes('/projects') && !path.includes('/tasks'),
      ),
    ).toHaveLength(8);
  });

  it('spec 003: describes every projects endpoint, with 404 for no access', () => {
    const base = '/api/v1/organizations/{organizationId}/projects';
    const expected: Array<[string, string]> = [
      ['get', base],
      ['post', base],
      ['get', `${base}/by-key/{key}`],
      ['get', `${base}/{projectId}`],
      ['patch', `${base}/{projectId}`],
      ['post', `${base}/{projectId}/archive`],
      ['post', `${base}/{projectId}/restore`],
      ['get', `${base}/{projectId}/workflow`],
      ['get', `${base}/{projectId}/members`],
      ['post', `${base}/{projectId}/members`],
      ['get', `${base}/{projectId}/member-candidates`],
      ['patch', `${base}/{projectId}/members/{userId}`],
      ['delete', `${base}/{projectId}/members/{userId}`],
    ];
    const paths = document.paths ?? {};

    for (const [method, path] of expected) {
      const operation = paths[path]?.[method as 'get'];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(Object.keys(operation?.responses ?? {}), `${method} ${path}`).toContain('404');
    }
    expect(Object.keys(paths).filter((path) => path.includes('/projects'))).toHaveLength(9);
  });

  it('spec 004: describes every tasks endpoint, with 404 and literal routes', () => {
    const base = '/api/v1/organizations/{organizationId}/tasks';
    const expected: Array<[string, string]> = [
      ['get', base],
      ['post', base],
      ['get', `${base}/assignable-users`],
      ['get', `${base}/by-key/{key}`],
      ['get', `${base}/{taskId}`],
      ['patch', `${base}/{taskId}`],
      ['delete', `${base}/{taskId}`],
      ['put', `${base}/{taskId}/assignee`],
      ['post', `${base}/{taskId}/transition`],
      ['post', `${base}/{taskId}/cancel`],
      ['post', `${base}/{taskId}/reopen`],
      ['post', `${base}/{taskId}/dependencies`],
      ['delete', `${base}/{taskId}/dependencies/{blockingTaskId}`],
    ];
    const paths = document.paths ?? {};

    for (const [method, path] of expected) {
      const operation = paths[path]?.[method as 'get'];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(Object.keys(operation?.responses ?? {}), `${method} ${path}`).toContain('404');
    }
    expect(Object.keys(paths).filter((path) => path.includes('/tasks'))).toHaveLength(10);
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
