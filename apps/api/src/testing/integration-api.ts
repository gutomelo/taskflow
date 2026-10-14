import { Router, type Express, type RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
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
import { startPostgresTestDatabase } from '@taskflow/backend/shared/infrastructure/testing';
import { InMemoryUserDirectory } from '@taskflow/backend/organizations/application/testing';
import { InMemoryProjectsUserDirectory } from '@taskflow/backend/projects/application/testing';
import { createApp } from '../app';
import { createMembershipRoleChanges } from '../modules/adapters/membership-role-changes.adapter';
import { createContributorChanges } from '../modules/adapters/contributor-changes.adapter';
import { createOrganizationAccess } from '../modules/adapters/organization-access.adapter';
import { composeApiRouters } from '../modules/api-routers';
import { mergeDomainErrors } from '../modules/domain-errors';
import { createOrganizationsModule } from '../modules/organizations.module';
import { createProjectsFoundation, createProjectsModule } from '../modules/projects.module';
import { createProjectAccess } from '../modules/adapters/project-access.adapter';
import { createTasksFoundation, createTasksModule } from '../modules/tasks.module';
import type { TestClient } from './isolation-cases';
import { listTenantRoutes, type RouteKey } from './tenant-isolation';

const APP_ORIGIN = 'http://localhost:4200';

export interface IntegrationApi {
  readonly prisma: PrismaClient;
  readonly app: Express;
  /** Rotas do escopo do tenant lidas da composição real. */
  readonly tenantRoutes: ReadonlyArray<RouteKey>;
  /** Conta verificada visível para `organizations` e `projects`. */
  addAccount(id: string, email: string): void;
  /** Cliente com sessão (header de teste) e CSRF como o Angular fará. */
  clientFor(userId: string): TestClient;
  stop(): Promise<void>;
}

/**
 * API real com PostgreSQL efêmero e a **mesma composição** de `main.ts` (ordem de montagem,
 * adaptadores, uma instância do runner). Só a identidade é trocada por uma sessão de teste.
 */
export async function startIntegrationApi(): Promise<IntegrationApi> {
  const database = await startPostgresTestDatabase();
  const prisma = createPrismaClient({ databaseUrl: database.connectionUri });
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
  const users = new InMemoryUserDirectory();
  const projectUsers = new InMemoryProjectsUserDirectory();
  const clock = new SystemClock();
  const logger = pino({ level: 'silent' });
  const tasksFoundation = createTasksFoundation({ transactions, clock });
  const foundation = createProjectsFoundation({
    transactions,
    clock,
    contributorChanges: createContributorChanges(tasksFoundation),
  });
  const organizations = createOrganizationsModule({
    logger,
    transactions,
    outbox: new PrismaOutboxWriter(transactions),
    rateLimiter: new InMemoryRateLimiter(),
    pseudonymizer: fakePseudonymizer,
    idGenerator: new UuidV7Generator(),
    clock,
    users,
    authenticate,
    csrf,
    membershipRoleChanges: createMembershipRoleChanges(foundation),
  });
  const projects = createProjectsModule({
    foundation,
    logger,
    transactions,
    rateLimiter: new InMemoryRateLimiter(),
    idGenerator: new UuidV7Generator(),
    clock,
    organizationAccess: createOrganizationAccess(organizations),
    users: projectUsers,
  });
  const tasks = createTasksModule({
    foundation: tasksFoundation,
    logger,
    transactions,
    rateLimiter: new InMemoryRateLimiter(),
    idGenerator: new UuidV7Generator(),
    clock,
    projectAccess: createProjectAccess(projects),
    // Mesmas contas de `projects` (só o nome).
    users: {
      async getNames(userIds) {
        const accounts = await projectUsers.getAccounts(userIds);
        return new Map([...accounts].map(([id, account]) => [id, account.name] as const));
      },
    },
  });
  // No lugar do router de identidade: só a emissão do cookie CSRF ligada à sessão de teste.
  const identityRouter = Router().get('/test/csrf', authenticate, (req, res) => {
    csrf.issue(res, req.actor?.sessionId);
    res.status(204).end();
  });
  const composed = composeApiRouters({
    identityRouter,
    authenticate,
    csrf,
    organizations,
    projects,
    tasks,
  });
  const app = createApp({
    config: { trustProxy: false, jsonBodyLimit: '100kb', healthCheckTimeoutMs: 100 },
    logger,
    probes: [],
    apiRouters: composed.apiRouters,
    domainErrors: mergeDomainErrors(
      organizations.domainErrors,
      projects.domainErrors,
      tasks.domainErrors,
    ),
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
    const mutate = async (
      method: 'post' | 'patch' | 'put' | 'delete',
      path: string,
      body?: object,
    ) => {
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
      put: (path, body) => mutate('put', path, body),
      delete: (path) => mutate('delete', path),
    };
  }

  return {
    prisma,
    app,
    tenantRoutes: listTenantRoutes(composed.tenantScope),
    addAccount(id, email) {
      const name = email.split('@')[0] ?? email;
      users.add({ id, name, email, emailVerified: true });
      projectUsers.add({ id, name, email });
    },
    clientFor,
    async stop() {
      await prisma.$disconnect();
      await database.stop();
    },
  };
}
