import { Router, type RequestHandler } from 'express';
import request from 'supertest';
import { createCsrfProtection } from '../csrf/csrf';
import { HttpError } from '../errors/http-error';
import { notFoundHandler } from '../errors/problem-details';
import { createTestApp, fakeActorFromHeader } from '../testing/test-app';
import { tenantRequestContextFrom } from './tenant-context';
import { createTenantScope } from './tenant-scope';

const ORGANIZATION = '0192a000-0000-7000-8000-000000000001';
const APP_ORIGIN = 'http://localhost:4200';

function buildApp() {
  const contextRouter = Router({ mergeParams: true });
  contextRouter.get('/things', (req, res) => {
    res.json(tenantRequestContextFrom(req).tenant);
  });
  contextRouter.post('/things', (req, res) => {
    res.status(201).json(tenantRequestContextFrom(req).tenant);
  });
  // Como `createAuthenticate` obrigatório: sem sessão ⇒ 401.
  const requireActor: RequestHandler = (req, res, next) => {
    fakeActorFromHeader(req, res, () => {
      next(req.actor ? undefined : new HttpError(401, 'UNAUTHENTICATED', 'Sessão necessária'));
    });
  };
  return createTestApp((app) => {
    app.use(
      '/api/v1',
      createTenantScope({
        authenticate: requireActor,
        csrf: createCsrfProtection({
          appOrigin: APP_ORIGIN,
          secret: 's'.repeat(43),
          secureCookie: true,
        }),
        resolve: async ({ organizationId }) =>
          organizationId === ORGANIZATION ? { organizationRole: 'admin' } : null,
        routers: [contextRouter],
      }),
    );
    app.use(notFoundHandler);
  });
}

describe('createTenantScope (ADR 0012)', () => {
  it('resolves the tenant for routes of the context routers, under the prefix', async () => {
    const response = await request(buildApp())
      .get(`/api/v1/organizations/${ORGANIZATION}/things`)
      .set('x-test-session', 's-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ organizationId: ORGANIZATION, organizationRole: 'admin' });
  });

  it('answers 404 without membership and refuses unauthenticated requests first', async () => {
    const app = buildApp();
    const other = '0192a000-0000-7000-8000-000000000002';

    const withoutMembership = await request(app)
      .get(`/api/v1/organizations/${other}/things`)
      .set('x-test-session', 's-1');
    const anonymous = await request(app).get(`/api/v1/organizations/${ORGANIZATION}/things`);

    expect(withoutMembership.status).toBe(404);
    expect(withoutMembership.body.code).toBe('ORGANIZATION_NOT_FOUND');
    expect(anonymous.status).toBe(401);
  });

  it('requires CSRF on mutations before resolving the tenant', async () => {
    const response = await request(buildApp())
      .post(`/api/v1/organizations/${ORGANIZATION}/things`)
      .set('x-test-session', 's-1');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('CSRF_VALIDATION_FAILED');
  });

  it('does not capture routes outside the prefix', async () => {
    const response = await request(buildApp())
      .post('/api/v1/organizations')
      .set('x-test-session', 's-1');

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ROUTE_NOT_FOUND');
  });
});
