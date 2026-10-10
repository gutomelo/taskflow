import { randomUUID } from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import {
  fakePseudonymizer,
  InMemoryRateLimiter,
} from '@taskflow/backend/shared/application/testing';
import { createCsrfProtection, createTenantScope, HttpError } from '@taskflow/backend/shared/http';
import {
  createPrismaClient,
  PrismaOutboxWriter,
  PrismaTransactionRunner,
  SystemClock,
  UuidV7Generator,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import { InMemoryUserDirectory } from '@taskflow/backend/organizations/application/testing';
import {
  invitationPageSchema,
  invitationSchema,
  memberPageSchema,
  myOrganizationListSchema,
  organizationSchema,
  problemDetailsSchema,
} from '@taskflow/contracts';
import { createApp } from '../app';
import { createOrganizationsModule } from './organizations.module';

const APP_ORIGIN = 'http://localhost:4200';

/**
 * RNF-01 / CA-03 / CA-09 (T14): a API real com PostgreSQL. Ana é owner de A; B tem os próprios
 * membros e um convite aberto. Nada de B é lido, listado, alterado ou referenciado por Ana.
 */
describe('tenant isolation over HTTP (integration, T14)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let app: Express;
  const users = new InMemoryUserDirectory();
  const [ana, bob, bia] = [randomUUID(), randomUUID(), randomUUID()];

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    const transactions = new PrismaTransactionRunner(prisma);
    const csrf = createCsrfProtection({
      appOrigin: APP_ORIGIN,
      secret: 's'.repeat(43),
      secureCookie: true,
    });
    // Sessão já verificada (como `createAuthenticate`), vinda de um header de teste.
    const authenticate: RequestHandler = (req, _res, next) => {
      const userId = req.get('x-test-user');
      if (!userId) {
        next(new HttpError(401, 'UNAUTHENTICATED', 'Sessão necessária'));
        return;
      }
      req.actor = { userId, sessionId: `s-${userId}` };
      next();
    };
    const organizations = createOrganizationsModule({
      logger: pino({ level: 'silent' }),
      transactions,
      outbox: new PrismaOutboxWriter(transactions),
      rateLimiter: new InMemoryRateLimiter(),
      pseudonymizer: fakePseudonymizer,
      idGenerator: new UuidV7Generator(),
      clock: new SystemClock(),
      users,
      authenticate,
      csrf,
    });
    const csrfRouter = (await import('express')).Router();
    csrfRouter.get('/test/csrf', authenticate, (req, res) => {
      csrf.issue(res, req.actor?.sessionId);
      res.status(204).end();
    });
    app = createApp({
      config: { trustProxy: false, jsonBodyLimit: '100kb', healthCheckTimeoutMs: 100 },
      logger: pino({ level: 'silent' }),
      probes: [],
      apiRouters: [
        csrfRouter,
        organizations.router,
        createTenantScope({
          authenticate,
          csrf,
          resolve: organizations.resolveTenant,
          routers: [organizations.tenantRouter],
        }),
      ],
      domainErrors: organizations.domainErrors,
    });
    for (const [id, email] of [
      [ana, 'ana@exemplo.com'],
      [bob, 'bob@exemplo.com'],
      [bia, 'bia@exemplo.com'],
    ] as const) {
      users.add({ id, name: email.split('@')[0] ?? email, email, emailVerified: true });
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  function clientFor(userId: string) {
    let token = '';
    const csrfToken = async (): Promise<string> => {
      if (token) return token;
      const response = await request(app).get('/api/v1/test/csrf').set('x-test-user', userId);
      const raw = response.headers['set-cookie'];
      const cookie = (Array.isArray(raw) ? raw : [raw]).find((value) =>
        value?.startsWith('__Host-tf_csrf='),
      );
      const issued = cookie?.split(';')[0]?.slice('__Host-tf_csrf='.length) ?? '';
      token = issued;
      return issued;
    };
    const mutate = async (method: 'post' | 'patch' | 'delete', path: string, body?: object) => {
      const value = await csrfToken();
      return request(app)
        [method](`/api/v1${path}`)
        .set('x-test-user', userId)
        .set('Cookie', [`__Host-tf_csrf=${value}`])
        .set('Origin', APP_ORIGIN)
        .set('X-CSRF-Token', value)
        .send(body);
    };
    return {
      get: (path: string) => request(app).get(`/api/v1${path}`).set('x-test-user', userId),
      post: (path: string, body?: object) => mutate('post', path, body),
      patch: (path: string, body?: object) => mutate('patch', path, body),
      delete: (path: string) => mutate('delete', path),
    };
  }

  /** Estado de B no banco, para provar que nada mudou. */
  async function snapshotOf(organizationId: string) {
    return {
      organization: await prisma.organization.findUnique({ where: { id: organizationId } }),
      memberships: await prisma.membership.findMany({
        where: { organizationId },
        orderBy: { userId: 'asc' },
      }),
      invitations: await prisma.invitation.findMany({
        where: { organizationId },
        orderBy: { id: 'asc' },
      }),
    };
  }

  async function setup() {
    const asAna = clientFor(ana);
    const asBob = clientFor(bob);
    const create = async (client: ReturnType<typeof clientFor>, slug: string) => {
      const response = await client.post('/organizations', { name: `Org ${slug}`, slug });
      expect(response.status).toBe(201);
      return organizationSchema.parse(response.body).id;
    };
    const orgA = await create(asAna, `a-${randomUUID().slice(0, 8)}`);
    const orgB = await create(asBob, `b-${randomUUID().slice(0, 8)}`);
    const invitation = await asBob.post(`/organizations/${orgB}/invitations`, {
      email: `convidada-${randomUUID().slice(0, 6)}@exemplo.com`,
      role: 'member',
    });
    expect(invitation.status).toBe(201);
    await prisma.membership.create({
      data: {
        id: randomUUID(),
        organizationId: orgB,
        userId: bia,
        role: 'member',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return { asAna, orgA, orgB, invitationB: invitationSchema.parse(invitation.body).id };
  }

  function expectNotFound(response: request.Response, code: string) {
    expect(response.status).toBe(404);
    expect(problemDetailsSchema.parse(response.body).code).toBe(code);
  }

  it('CA-03: every endpoint under the prefix of B answers 404 to a member of A only', async () => {
    const { asAna, orgB, invitationB } = await setup();
    const before = await snapshotOf(orgB);
    const prefix = `/organizations/${orgB}`;

    const responses = [
      await asAna.get(prefix),
      await asAna.patch(prefix, { name: 'Tomada', version: 1 }),
      await asAna.get(`${prefix}/members`),
      await asAna.patch(`${prefix}/members/${bia}`, { role: 'admin', version: 1 }),
      await asAna.delete(`${prefix}/members/${bia}?version=1`),
      await asAna.get(`${prefix}/invitations`),
      await asAna.post(`${prefix}/invitations`, { email: 'x@exemplo.com', role: 'admin' }),
      await asAna.post(`${prefix}/invitations/${invitationB}/resend`),
      await asAna.delete(`${prefix}/invitations/${invitationB}`),
    ];

    for (const response of responses) expectNotFound(response, 'ORGANIZATION_NOT_FOUND');
    // Mesma resposta para organização inexistente (sem oráculo de existência).
    expectNotFound(await asAna.get(`/organizations/${randomUUID()}`), 'ORGANIZATION_NOT_FOUND');
    expect(await snapshotOf(orgB)).toEqual(before);
  });

  it('CA-03: real ids of B under the prefix of A answer 404 and change nothing', async () => {
    const { asAna, orgA, orgB, invitationB } = await setup();
    const before = await snapshotOf(orgB);
    const prefix = `/organizations/${orgA}`;

    expectNotFound(
      await asAna.patch(`${prefix}/members/${bia}`, { role: 'viewer', version: 1 }),
      'MEMBER_NOT_FOUND',
    );
    expectNotFound(
      await asAna.patch(`${prefix}/members/${bob}`, { role: 'viewer', version: 1 }),
      'MEMBER_NOT_FOUND',
    );
    expectNotFound(await asAna.delete(`${prefix}/members/${bia}?version=1`), 'MEMBER_NOT_FOUND');
    expectNotFound(
      await asAna.post(`${prefix}/invitations/${invitationB}/resend`),
      'INVITATION_NOT_FOUND',
    );
    expectNotFound(
      await asAna.delete(`${prefix}/invitations/${invitationB}`),
      'INVITATION_NOT_FOUND',
    );

    const members = await asAna.get(`${prefix}/members`);
    const invitations = await asAna.get(`${prefix}/invitations`);
    expect(memberPageSchema.parse(members.body).items.map((member) => member.userId)).toEqual([
      ana,
    ]);
    expect(invitationPageSchema.parse(invitations.body).items).toEqual([]);
    expect(await snapshotOf(orgB)).toEqual(before);
  });

  it('malformed ids answer 404 instead of reaching the database', async () => {
    const { asAna, orgA } = await setup();

    expectNotFound(await asAna.get('/organizations/nao-e-uuid/members'), 'ORGANIZATION_NOT_FOUND');
    expectNotFound(
      await asAna.patch(`/organizations/${orgA}/members/123`, { role: 'viewer', version: 1 }),
      'MEMBER_NOT_FOUND',
    );
    expectNotFound(
      await asAna.delete(`/organizations/${orgA}/invitations/123`),
      'INVITATION_NOT_FOUND',
    );
  });

  it('CA-09: a removed member loses access on the next request', async () => {
    const { orgB } = await setup();
    const asBia = clientFor(bia);
    const asBob = clientFor(bob);
    expect((await asBia.get(`/organizations/${orgB}`)).status).toBe(200);

    expect((await asBob.delete(`/organizations/${orgB}/members/${bia}?version=1`)).status).toBe(
      204,
    );

    expectNotFound(await asBia.get(`/organizations/${orgB}`), 'ORGANIZATION_NOT_FOUND');
    const mine = myOrganizationListSchema.parse((await asBia.get('/me/organizations')).body);
    expect(mine.items.map((organization) => organization.id)).not.toContain(orgB);
  });
});
