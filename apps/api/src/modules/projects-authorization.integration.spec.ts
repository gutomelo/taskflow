import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { organizationSchema, problemDetailsSchema, projectSchema } from '@taskflow/contracts';
import { startIntegrationApi, type IntegrationApi } from '../testing/integration-api';
import type { TestClient } from '../testing/isolation-cases';
import type { RouteKey } from '../testing/tenant-isolation';

type Target = Readonly<{ projectId: string; key: string; otherUserId: string }>;
type Kind = 'read' | 'manage';

/**
 * Requisição por rota de projeto. As de gestão usam dados que gerariam erro de **estado** (versão
 * velha, duplicidade, teto) se a permissão fosse checada depois: 403 tem de vir antes (sem oráculo).
 */
const REQUESTS: Readonly<
  Record<
    RouteKey,
    Readonly<{
      kind: Kind;
      send: (actor: TestClient, base: string, target: Target) => Promise<Response>;
    }>
  >
> = {
  'GET /organizations/:organizationId/projects/by-key/:key': {
    kind: 'read',
    send: (actor, base, target) => actor.get(`${base}/projects/by-key/${target.key}`),
  },
  'GET /organizations/:organizationId/projects/:projectId': {
    kind: 'read',
    send: (actor, base, target) => actor.get(`${base}/projects/${target.projectId}`),
  },
  'PATCH /organizations/:organizationId/projects/:projectId': {
    kind: 'manage',
    send: (actor, base, target) =>
      actor.patch(`${base}/projects/${target.projectId}`, { name: 'Tomado', version: 99 }),
  },
  'POST /organizations/:organizationId/projects/:projectId/archive': {
    kind: 'manage',
    send: (actor, base, target) =>
      actor.post(`${base}/projects/${target.projectId}/archive`, { version: 99 }),
  },
  'POST /organizations/:organizationId/projects/:projectId/restore': {
    kind: 'manage',
    // Projeto ativo: para quem pode, seria 200 idempotente; sem permissão, 403.
    send: (actor, base, target) =>
      actor.post(`${base}/projects/${target.projectId}/restore`, { version: 99 }),
  },
  'GET /organizations/:organizationId/projects/:projectId/workflow': {
    kind: 'read',
    send: (actor, base, target) => actor.get(`${base}/projects/${target.projectId}/workflow`),
  },
  'GET /organizations/:organizationId/projects/:projectId/members': {
    kind: 'read',
    send: (actor, base, target) => actor.get(`${base}/projects/${target.projectId}/members`),
  },
  'GET /organizations/:organizationId/projects/:projectId/member-candidates': {
    kind: 'manage',
    send: (actor, base, target) =>
      actor.get(`${base}/projects/${target.projectId}/member-candidates`),
  },
  'POST /organizations/:organizationId/projects/:projectId/members': {
    kind: 'manage',
    // Alvo que já participa: com permissão seria 409 ALREADY_A_PROJECT_MEMBER.
    send: (actor, base, target) =>
      actor.post(`${base}/projects/${target.projectId}/members`, {
        userId: target.otherUserId,
        role: 'manager',
      }),
  },
  'PATCH /organizations/:organizationId/projects/:projectId/members/:userId': {
    kind: 'manage',
    send: (actor, base, target) =>
      actor.patch(`${base}/projects/${target.projectId}/members/${target.otherUserId}`, {
        role: 'viewer',
        version: 99,
      }),
  },
  // Spec 005: edições do workflow (board:configure), com versão velha e status inexistente — 403 antes.
  'POST /organizations/:organizationId/projects/:projectId/workflow/statuses': {
    kind: 'manage',
    send: (actor, base, target) =>
      actor.post(`${base}/projects/${target.projectId}/workflow/statuses`, {
        name: 'A fazer',
        category: 'todo',
        version: 99,
      }),
  },
  'PATCH /organizations/:organizationId/projects/:projectId/workflow/statuses/:statusId': {
    kind: 'manage',
    send: (actor, base, target) =>
      actor.patch(
        `${base}/projects/${target.projectId}/workflow/statuses/0192a000-0000-7000-8000-00000000ffff`,
        {
          name: 'X',
          version: 99,
        },
      ),
  },
  'DELETE /organizations/:organizationId/projects/:projectId/workflow/statuses/:statusId': {
    kind: 'manage',
    send: (actor, base, target) =>
      actor.delete(
        `${base}/projects/${target.projectId}/workflow/statuses/0192a000-0000-7000-8000-00000000ffff?version=99`,
      ),
  },
  'PUT /organizations/:organizationId/projects/:projectId/workflow/order': {
    kind: 'manage',
    send: (actor, base, target) =>
      actor.put(`${base}/projects/${target.projectId}/workflow/order`, {
        statusIds: ['0192a000-0000-7000-8000-00000000ffff'],
        version: 99,
      }),
  },
  'PUT /organizations/:organizationId/projects/:projectId/workflow/transitions': {
    kind: 'manage',
    send: (actor, base, target) =>
      actor.put(`${base}/projects/${target.projectId}/workflow/transitions`, {
        transitions: [],
        version: 99,
      }),
  },
  'DELETE /organizations/:organizationId/projects/:projectId/members/:userId': {
    kind: 'manage',
    send: (actor, base, target) =>
      actor.delete(`${base}/projects/${target.projectId}/members/${target.otherUserId}?version=99`),
  },
};

/** O corpo sem os campos que variam por requisição (`instance` repete o caminho; `requestId`). */
function comparable(response: Response) {
  const {
    instance: _instance,
    requestId: _requestId,
    ...problem
  } = problemDetailsSchema.parse(response.body);
  // O status do corpo precisa bater com o da resposta HTTP.
  expect(problem.status).toBe(response.status);
  return problem;
}

/** Spec 003, T10 (CA-03, CA-07): autorização dentro da organização, gerada das rotas reais. */
describe('projects authorization within the organization (integration, spec 003 T10)', () => {
  let api: IntegrationApi;
  const id = () => randomUUID();
  const users = {
    owner: id(),
    admin: id(),
    memberOutside: id(),
    viewerOutside: id(),
    manager: id(),
    participant: id(),
    viewerParticipant: id(),
    onlyInP2: id(),
  };

  beforeAll(async () => {
    api = await startIntegrationApi();
    for (const [name, userId] of Object.entries(users))
      api.addAccount(userId, `${name}@exemplo.com`);
  });

  afterAll(async () => {
    await api?.stop();
  });

  async function world() {
    const { prisma } = api;
    const owner = api.clientFor(users.owner);
    const created = await owner.post('/organizations', {
      name: 'Acme',
      slug: `acme-${randomUUID().slice(0, 8)}`,
    });
    const organizationId = organizationSchema.parse(created.body).id;
    const roles: Array<[string, 'admin' | 'member' | 'viewer']> = [
      [users.admin, 'admin'],
      [users.memberOutside, 'member'],
      [users.viewerOutside, 'viewer'],
      [users.manager, 'member'],
      [users.participant, 'member'],
      [users.viewerParticipant, 'viewer'],
      [users.onlyInP2, 'member'],
    ];
    for (const [userId, role] of roles) {
      await prisma.membership.create({
        data: { id: randomUUID(), organizationId, userId, role, createdAt: new Date() },
      });
    }
    const base = `/organizations/${organizationId}`;
    const manager = api.clientFor(users.manager);
    const p1 = projectSchema.parse(
      (await manager.post(`${base}/projects`, { key: 'WEB', name: 'Website' })).body,
    );
    const p2 = projectSchema.parse(
      (await owner.post(`${base}/projects`, { key: 'APP', name: 'Aplicativo' })).body,
    );
    const add = (client: TestClient, projectId: string, userId: string, role: string) =>
      client.post(`${base}/projects/${projectId}/members`, { userId, role });
    expect((await add(manager, p1.id, users.participant, 'member')).status).toBe(201);
    expect((await add(manager, p1.id, users.viewerParticipant, 'viewer')).status).toBe(201);
    expect((await add(owner, p2.id, users.onlyInP2, 'member')).status).toBe(201);
    return { organizationId, base, p1, p2 };
  }

  const projectRoutes = () =>
    api.tenantRoutes.filter(
      (route) => route.includes('/projects/:projectId') || route.includes('/projects/by-key/'),
    );

  it('covers every project route (a new one without a request makes this fail)', () => {
    expect([...projectRoutes()].sort()).toEqual(Object.keys(REQUESTS).sort());
  });

  it('CA-03: someone who does not participate gets the same 404 as for a missing project, on every route', async () => {
    const { base, p1 } = await world();
    const visible: Target = { projectId: p1.id, key: p1.key, otherUserId: users.participant };
    const missing: Target = {
      projectId: randomUUID(),
      key: 'NOPE',
      otherUserId: users.participant,
    };

    for (const name of ['memberOutside', 'viewerOutside'] as const) {
      const actor = api.clientFor(users[name]);
      for (const route of projectRoutes()) {
        const request = REQUESTS[route];
        if (!request) throw new Error(`no request for ${route}`);
        const hidden = await request.send(actor, base, visible);
        const absent = await request.send(actor, base, missing);
        expect(comparable(hidden), `${route} › ${name}`).toEqual(comparable(absent));
        expect(comparable(hidden), `${route} › ${name}`).toMatchObject({
          status: 404,
          code: 'PROJECT_NOT_FOUND',
        });
      }
    }
    // Sair de um projeto do qual não participa também é 404 (não 403).
    const leave = await api
      .clientFor(users.memberOutside)
      .delete(`${base}/projects/${p1.id}/members/${users.memberOutside}?version=1`);
    expect(comparable(leave)).toMatchObject({ status: 404, code: 'PROJECT_NOT_FOUND' });
  });

  it('CA-03: participants without permission get 403 on management, before any state error; reads work', async () => {
    const { base, p1 } = await world();
    const target: Target = { projectId: p1.id, key: p1.key, otherUserId: users.manager };

    for (const name of ['participant', 'viewerParticipant'] as const) {
      const actor = api.clientFor(users[name]);
      for (const route of projectRoutes()) {
        const request = REQUESTS[route];
        if (!request) throw new Error(`no request for ${route}`);
        const response = await request.send(actor, base, target);
        if (request.kind === 'manage') {
          expect(comparable(response), `${route} › ${name}`).toMatchObject({
            status: 403,
            code: 'INSUFFICIENT_ROLE',
          });
        } else {
          expect(response.status, `${route} › ${name}`).toBe(200);
        }
      }
    }
  });

  it('owner, admin and the project manager read every project route; owner and admin without participating', async () => {
    const { base, p1 } = await world();
    const target: Target = { projectId: p1.id, key: p1.key, otherUserId: users.participant };

    for (const name of ['owner', 'admin', 'manager'] as const) {
      const actor = api.clientFor(users[name]);
      for (const route of projectRoutes()) {
        const request = REQUESTS[route];
        if (request?.kind !== 'read') continue;
        expect((await request.send(actor, base, target)).status, `${route} › ${name}`).toBe(200);
      }
      expect((await actor.get(`${base}/projects/${p1.id}/member-candidates`)).status, name).toBe(
        200,
      );
    }
  });

  it('CA-07 (IDOR): the manager of P1 cannot change or remove someone who only participates in P2', async () => {
    const { organizationId, base, p1, p2 } = await world();
    const manager = api.clientFor(users.manager);
    const before = await api.prisma.projectMember.findMany({
      where: { organizationId, projectId: p2.id },
    });

    const change = await manager.patch(`${base}/projects/${p1.id}/members/${users.onlyInP2}`, {
      role: 'viewer',
      version: 1,
    });
    const remove = await manager.delete(
      `${base}/projects/${p1.id}/members/${users.onlyInP2}?version=1`,
    );

    for (const response of [change, remove]) {
      expect(comparable(response)).toMatchObject({ status: 404, code: 'PROJECT_MEMBER_NOT_FOUND' });
    }
    expect(
      await api.prisma.projectMember.findMany({ where: { organizationId, projectId: p2.id } }),
    ).toEqual(before);
    // E sobre P2 ele não tem acesso nenhum (não participa): 404 do projeto.
    const direct = await manager.patch(`${base}/projects/${p2.id}/members/${users.onlyInP2}`, {
      role: 'viewer',
      version: 1,
    });
    expect(comparable(direct)).toMatchObject({ status: 404, code: 'PROJECT_NOT_FOUND' });
  });
});
