import { randomUUID } from 'node:crypto';
import { Router, type Express, type RequestHandler } from 'express';
import { pino } from 'pino';
import request, { type Response } from 'supertest';
import {
  fakePseudonymizer,
  InMemoryRateLimiter,
} from '@taskflow/backend/shared/application/testing';
import { createCsrfProtection, HttpError } from '@taskflow/backend/shared/http';
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
  invitationSchema,
  myOrganizationListSchema,
  organizationSchema,
  problemDetailsSchema,
} from '@taskflow/contracts';
import { createApp } from '../app';
import { ISOLATION_CASES, type IsolationWorld, type TestClient } from '../testing/isolation-cases';
import { concretePath, listTenantRoutes, methodOf, pathParams } from '../testing/tenant-isolation';
import { composeApiRouters } from './api-routers';
import { createOrganizationsModule } from './organizations.module';

const APP_ORIGIN = 'http://localhost:4200';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * RNF-01 (spec 002) e RF-08/CA-07 (spec 006): a API real com PostgreSQL e a **mesma composição**
 * de `main.ts`. Para cada rota do escopo do tenant: (1) caso gerado — owner de A chama o prefixo
 * de B ⇒ 404; (2) variantes declaradas — ids reais de B sob o prefixo de A ⇒ 404 ou lista sem B.
 * Sempre: banco de B idêntico (todas as tabelas com `organization_id`) e nenhum id de B (canário)
 * em respostas de A.
 */
describe('tenant isolation over HTTP (integration, spec 002/T14 + spec 006/T6)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let app: Express;
  let tenantRoutes: string[];
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
    // No lugar do router de identidade: só a emissão do cookie CSRF ligada à sessão de teste.
    const identityRouter = Router().get('/test/csrf', authenticate, (req, res) => {
      csrf.issue(res, req.actor?.sessionId);
      res.status(204).end();
    });
    const composed = composeApiRouters({ identityRouter, authenticate, csrf, organizations });
    tenantRoutes = listTenantRoutes(composed.tenantScope);
    app = createApp({
      config: { trustProxy: false, jsonBodyLimit: '100kb', healthCheckTimeoutMs: 100 },
      logger: pino({ level: 'silent' }),
      probes: [],
      apiRouters: composed.apiRouters,
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

  function clientFor(userId: string): TestClient {
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
      get: (path) => request(app).get(`/api/v1${path}`).set('x-test-user', userId),
      post: (path, body) => mutate('post', path, body),
      patch: (path, body) => mutate('patch', path, body),
      delete: (path) => mutate('delete', path),
    };
  }

  /** Tabelas tenant-scoped descobertas no próprio banco: tabela nova entra sem mudar o teste. */
  async function tenantTables(): Promise<string[]> {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'organization_id'
      ORDER BY table_name`;
    return rows.map((row) => row.table_name);
  }

  /** Estado de B: a organização e todas as linhas com `organization_id` de B. */
  async function snapshotOf(organizationId: string): Promise<string> {
    const parts: unknown[] = [
      await prisma.organization.findUnique({ where: { id: organizationId } }),
    ];
    for (const table of await tenantTables()) {
      // Nome de tabela vem do information_schema (não de entrada externa); valor parametrizado.
      // Ordena pela linha inteira: tabelas com chave composta (sem coluna `id`) também entram.
      parts.push(
        await prisma.$queryRawUnsafe(
          `SELECT * FROM "${table.replaceAll('"', '')}" AS row WHERE organization_id = $1::uuid ORDER BY row::text`,
          organizationId,
        ),
      );
    }
    return JSON.stringify(parts, (_key, value: unknown) =>
      typeof value === 'bigint' ? String(value) : value,
    );
  }

  async function world(): Promise<IsolationWorld> {
    const asAna = clientFor(ana);
    const asBob = clientFor(bob);
    const create = async (client: TestClient, slug: string) => {
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
    return {
      orgA,
      orgB,
      ofB: { userId: bia, invitationId: invitationSchema.parse(invitation.body).id },
      asOwnerOfA: asAna,
    };
  }

  /** Ids de B que não podem aparecer em nenhuma resposta de A (canários). */
  async function canariesOf(organizationId: string): Promise<Set<string>> {
    // Inclui ids de contas que só pertencem a B (bob, bia): A não pode descobri-las.
    return new Set(
      ((await snapshotOf(organizationId)).match(UUID) ?? []).map((id) => id.toLowerCase()),
    );
  }

  /**
   * Nenhum id de B na resposta, exceto os que a própria requisição levou (o `instance` do Problem
   * Details repete o caminho: A não aprende nada que já não tenha enviado).
   */
  function expectNoLeak(response: Response, canaries: ReadonlySet<string>) {
    const requested = new Set(
      (response.request.url.match(UUID) ?? []).map((id) => id.toLowerCase()),
    );
    const leaked = (response.text.match(UUID) ?? [])
      .map((id) => id.toLowerCase())
      .filter((id) => canaries.has(id) && !requested.has(id));
    expect(
      leaked,
      `ids de B na resposta de A (${response.request.method} ${response.request.url})`,
    ).toEqual([]);
  }

  function call(client: TestClient, method: string, path: string): Promise<Response> {
    if (method === 'get') return client.get(path);
    if (method === 'post') return client.post(path, {});
    if (method === 'patch')
      return client.patch(path, { version: 1, name: 'Tomada', role: 'viewer' });
    if (method === 'delete') return client.delete(`${path}?version=1`);
    throw new Error(`unexpected method ${method}`);
  }

  it('CA-07: every tenant route answers 404 to the owner of A under the prefix of B (generated cases)', async () => {
    const setup = await world();
    const before = await snapshotOf(setup.orgB);
    const canaries = await canariesOf(setup.orgB);

    for (const route of tenantRoutes) {
      const values = {
        organizationId: setup.orgB,
        ...Object.fromEntries(
          pathParams(route).map((name) => [name, setup.ofB[name] ?? randomUUID()]),
        ),
      };
      const response = await call(setup.asOwnerOfA, methodOf(route), concretePath(route, values));

      expect(response.status, route).toBe(404);
      expect(problemDetailsSchema.parse(response.body).code, route).toBe('ORGANIZATION_NOT_FOUND');
      expectNoLeak(response, canaries);
    }
    expect(await snapshotOf(setup.orgB)).toEqual(before);
  });

  it('CA-07: every declared reference to a real id of B under the prefix of A is isolated', async () => {
    const setup = await world();
    const before = await snapshotOf(setup.orgB);
    const canaries = await canariesOf(setup.orgB);

    for (const route of tenantRoutes) {
      for (const [reference, variant] of Object.entries(ISOLATION_CASES[route]?.references ?? {})) {
        const response = await variant.call(setup);
        const label = `${route} › ${reference}`;
        if (variant.expect === 'not-found') {
          expect(response.status, label).toBe(404);
        } else {
          expect(response.status, label).toBeLessThan(300);
        }
        expectNoLeak(response, canaries);
      }
    }
    expect(await snapshotOf(setup.orgB)).toEqual(before);
  });

  it('GET /me/organizations lists only the organizations of the actor (global route)', async () => {
    const setup = await world();

    const mine = myOrganizationListSchema.parse(
      (await setup.asOwnerOfA.get('/me/organizations')).body,
    );

    expect(mine.items.map((organization) => organization.id)).toContain(setup.orgA);
    expect(mine.items.map((organization) => organization.id)).not.toContain(setup.orgB);
  });

  it('malformed ids answer 404 instead of reaching the database', async () => {
    const setup = await world();
    const asAna = setup.asOwnerOfA;
    const code = async (response: Promise<Response>) =>
      problemDetailsSchema.parse((await response).body).code;

    expect(await code(asAna.get('/organizations/nao-e-uuid/members'))).toBe(
      'ORGANIZATION_NOT_FOUND',
    );
    expect(
      await code(
        asAna.patch(`/organizations/${setup.orgA}/members/123`, { role: 'viewer', version: 1 }),
      ),
    ).toBe('MEMBER_NOT_FOUND');
    expect(await code(asAna.delete(`/organizations/${setup.orgA}/invitations/123`))).toBe(
      'INVITATION_NOT_FOUND',
    );
  });

  it('CA-09 (spec 002): a removed member loses access on the next request', async () => {
    const { orgB } = await world();
    const asBia = clientFor(bia);
    const asBob = clientFor(bob);
    expect((await asBia.get(`/organizations/${orgB}`)).status).toBe(200);

    expect((await asBob.delete(`/organizations/${orgB}/members/${bia}?version=1`)).status).toBe(
      204,
    );

    expect((await asBia.get(`/organizations/${orgB}`)).status).toBe(404);
    const mine = myOrganizationListSchema.parse((await asBia.get('/me/organizations')).body);
    expect(mine.items.map((organization) => organization.id)).not.toContain(orgB);
  });
});
