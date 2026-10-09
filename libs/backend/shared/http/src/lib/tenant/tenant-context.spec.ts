import { Router, type RequestHandler } from 'express';
import request from 'supertest';
import type { Actor } from '@taskflow/backend/shared/application';
import { createTestApp } from '../testing/test-app';
import { createTenantContext, tenantRequestContextFrom } from './tenant-context';

const ORG_A = '01a11e1a-0000-7000-8000-00000000000a';
const ORG_B = '01a11e1a-0000-7000-8000-00000000000b';
const ana: Actor = { userId: 'user-ana', sessionId: 'session-1' };

/** Simula `authenticate`: header `x-test-user` presente ⇒ sessão de Ana. */
const fakeAuthenticate: RequestHandler = (req, _res, next) => {
  if (req.get('x-test-user')) req.actor = ana;
  next();
};

type Resolve = Parameters<typeof createTenantContext>[0]['resolve'];

function buildApp(resolve: Resolve) {
  return createTestApp((app) => {
    // Como no composition root: router de tenant montado no prefixo, contexto com mergeParams.
    const tenantRouter = Router({ mergeParams: true });
    tenantRouter.get('/members', (req, res) => {
      res.json(tenantRequestContextFrom(req));
    });
    app.use(
      '/organizations/:organizationId',
      fakeAuthenticate,
      createTenantContext({ resolve }),
      tenantRouter,
    );
    // Rota "esquecida" fora do prefixo: o helper precisa falhar fechado.
    app.get('/forgotten', fakeAuthenticate, (req, res) => {
      res.json(tenantRequestContextFrom(req));
    });
  });
}

const memberOfA: Resolve = async ({ organizationId }) =>
  organizationId === ORG_A ? { organizationRole: 'admin' } : null;

describe('createTenantContext (ADR 0012)', () => {
  it('builds the tenant context from a valid membership', async () => {
    const resolve = vi.fn(memberOfA);

    const response = await request(buildApp(resolve))
      .get(`/organizations/${ORG_A}/members`)
      .set('x-test-user', '1')
      .expect(200);

    expect(response.body).toMatchObject({
      actor: ana,
      tenant: { organizationId: ORG_A, organizationRole: 'admin' },
    });
    expect(resolve).toHaveBeenCalledWith({ userId: 'user-ana', organizationId: ORG_A });
  });

  it('normalizes the organization id to lower case', async () => {
    const response = await request(buildApp(memberOfA))
      .get(`/organizations/${ORG_A.toUpperCase()}/members`)
      .set('x-test-user', '1')
      .expect(200);

    expect(response.body.tenant.organizationId).toBe(ORG_A);
  });

  it('requires an authenticated session (401) before looking anything up', async () => {
    const resolve = vi.fn(memberOfA);

    const response = await request(buildApp(resolve)).get(`/organizations/${ORG_A}/members`);

    expect(response.status).toBe(401);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('answers the same 404 for another tenant, a malformed id and an unknown role', async () => {
    const resolve = vi.fn(async ({ organizationId }: { organizationId: string }) =>
      organizationId === ORG_A ? { organizationRole: 'superadmin' } : null,
    );
    const app = buildApp(resolve);

    const otherTenant = await request(app)
      .get(`/organizations/${ORG_B}/members`)
      .set('x-test-user', '1');
    const malformed = await request(app)
      .get('/organizations/not-a-uuid/members')
      .set('x-test-user', '1');
    const unknownRole = await request(app)
      .get(`/organizations/${ORG_A}/members`)
      .set('x-test-user', '1');

    for (const response of [otherTenant, malformed, unknownRole]) {
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        code: 'ORGANIZATION_NOT_FOUND',
        title: 'Organização não encontrada',
      });
    }
    // O id malformado nem chega ao banco.
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a route reads the tenant without the middleware', async () => {
    const response = await request(buildApp(memberOfA)).get('/forgotten').set('x-test-user', '1');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
