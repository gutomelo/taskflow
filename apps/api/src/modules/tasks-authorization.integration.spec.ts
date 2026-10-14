import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import {
  organizationSchema,
  problemDetailsSchema,
  projectSchema,
  taskPageSchema,
  taskSchema,
  workflowSchema,
} from '@taskflow/contracts';
import { startIntegrationApi, type IntegrationApi } from '../testing/integration-api';
import type { TestClient } from '../testing/isolation-cases';
import type { RouteKey } from '../testing/tenant-isolation';

type Target = Readonly<{
  taskId: string;
  key: string;
  projectId: string;
  statusId: string;
  otherTaskId: string;
  otherUserId: string;
}>;
type Kind = 'read' | 'write';

/**
 * Requisição por rota de tarefa. As de escrita usam dados que gerariam erro de **estado** (versão
 * velha, transição proibida, dependência inexistente) se a permissão fosse checada depois: 403 tem
 * de vir antes (sem oráculo).
 */
const REQUESTS: Readonly<
  Record<
    RouteKey,
    Readonly<{
      kind: Kind;
      /** Endereçada por tarefa (404 `TASK_NOT_FOUND`) ou por `projectId` (404 `PROJECT_NOT_FOUND`). */
      by: 'task' | 'project';
      send: (actor: TestClient, base: string, target: Target) => Promise<Response>;
    }>
  >
> = {
  'GET /organizations/:organizationId/tasks': {
    kind: 'read',
    by: 'project',
    send: (actor, base, target) => actor.get(`${base}/tasks?projectId=${target.projectId}`),
  },
  'POST /organizations/:organizationId/tasks': {
    kind: 'write',
    by: 'project',
    send: (actor, base, target) =>
      actor.post(`${base}/tasks`, { projectId: target.projectId, title: 'X', isRequired: true }),
  },
  'GET /organizations/:organizationId/tasks/assignable-users': {
    kind: 'write',
    by: 'project',
    send: (actor, base, target) =>
      actor.get(`${base}/tasks/assignable-users?projectId=${target.projectId}`),
  },
  'GET /organizations/:organizationId/tasks/by-key/:key': {
    kind: 'read',
    by: 'task',
    send: (actor, base, target) => actor.get(`${base}/tasks/by-key/${target.key}`),
  },
  'GET /organizations/:organizationId/tasks/:taskId': {
    kind: 'read',
    by: 'task',
    send: (actor, base, target) => actor.get(`${base}/tasks/${target.taskId}`),
  },
  'PATCH /organizations/:organizationId/tasks/:taskId': {
    kind: 'write',
    by: 'task',
    send: (actor, base, target) =>
      actor.patch(`${base}/tasks/${target.taskId}`, { title: 'Tomada', version: 99 }),
  },
  'DELETE /organizations/:organizationId/tasks/:taskId': {
    kind: 'write',
    by: 'task',
    send: (actor, base, target) => actor.delete(`${base}/tasks/${target.taskId}?version=99`),
  },
  'PUT /organizations/:organizationId/tasks/:taskId/assignee': {
    kind: 'write',
    by: 'task',
    send: (actor, base, target) =>
      actor.put(`${base}/tasks/${target.taskId}/assignee`, {
        assigneeUserId: target.otherUserId,
        version: 99,
      }),
  },
  'POST /organizations/:organizationId/tasks/:taskId/transition': {
    kind: 'write',
    by: 'task',
    // Destino `done` direto de `todo`: com permissão seria 409 de versão ou 422 de transição.
    send: (actor, base, target) =>
      actor.post(`${base}/tasks/${target.taskId}/transition`, {
        statusId: target.statusId,
        version: 99,
      }),
  },
  'POST /organizations/:organizationId/tasks/:taskId/cancel': {
    kind: 'write',
    by: 'task',
    send: (actor, base, target) =>
      actor.post(`${base}/tasks/${target.taskId}/cancel`, { version: 99 }),
  },
  'POST /organizations/:organizationId/tasks/:taskId/reopen': {
    kind: 'write',
    by: 'task',
    send: (actor, base, target) =>
      actor.post(`${base}/tasks/${target.taskId}/reopen`, { version: 99 }),
  },
  'POST /organizations/:organizationId/tasks/:taskId/dependencies': {
    kind: 'write',
    by: 'task',
    send: (actor, base, target) =>
      actor.post(`${base}/tasks/${target.taskId}/dependencies`, { blockingTaskId: target.taskId }),
  },
  // Spec 005: quadro (leitura por projectId) e movimento (escrita por tarefa).
  'GET /organizations/:organizationId/board': {
    kind: 'read',
    by: 'project',
    send: (actor, base, target) => actor.get(`${base}/board?projectId=${target.projectId}`),
  },
  'GET /organizations/:organizationId/board/columns/:statusId': {
    kind: 'read',
    by: 'project',
    send: (actor, base, target) =>
      actor.get(`${base}/board/columns/${target.statusId}?projectId=${target.projectId}`),
  },
  'POST /organizations/:organizationId/tasks/:taskId/move': {
    kind: 'write',
    by: 'task',
    // Versão velha e transição proibida: com permissão seria 409 ou 422.
    send: (actor, base, target) =>
      actor.post(`${base}/tasks/${target.taskId}/move`, {
        toStatusId: target.statusId,
        afterTaskId: target.otherTaskId,
        version: 99,
      }),
  },
  'DELETE /organizations/:organizationId/tasks/:taskId/dependencies/:blockingTaskId': {
    kind: 'write',
    by: 'task',
    send: (actor, base, target) =>
      actor.delete(`${base}/tasks/${target.taskId}/dependencies/${target.otherTaskId}`),
  },
};

/** O corpo sem os campos que variam por requisição (`instance` repete o caminho; `requestId`). */
function comparable(response: Response) {
  const {
    instance: _instance,
    requestId: _requestId,
    ...problem
  } = problemDetailsSchema.parse(response.body);
  expect(problem.status).toBe(response.status);
  return problem;
}

/** Spec 004, T10 (CA-09, RF-14): autorização de tarefas dentro da organização, das rotas reais. */
describe('tasks authorization within the organization (integration, spec 004 T10)', () => {
  let api: IntegrationApi;
  const id = () => randomUUID();
  const users = {
    owner: id(),
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

  /** P1 (manager; participant member; viewerParticipant viewer) e P2 (do owner; onlyInP2 member). */
  async function world() {
    const { prisma } = api;
    const owner = api.clientFor(users.owner);
    const created = await owner.post('/organizations', {
      name: 'Acme',
      slug: `acme-${randomUUID().slice(0, 8)}`,
    });
    const organizationId = organizationSchema.parse(created.body).id;
    const roles: Array<[string, 'member' | 'viewer']> = [
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
    const task = async (client: TestClient, body: object) => {
      const response = await client.post(`${base}/tasks`, body);
      expect(response.status).toBe(201);
      return taskSchema.parse(response.body);
    };
    const workflow = async (projectId: string) =>
      workflowSchema.parse((await owner.get(`${base}/projects/${projectId}/workflow`)).body);
    const t1 = await task(manager, { projectId: p1.id, title: 'Do manager' });
    const t2 = await task(manager, { projectId: p1.id, title: 'Outra' });
    const inP2 = await task(owner, { projectId: p2.id, title: 'Em P2' });
    return {
      organizationId,
      base,
      p1,
      p2,
      t1,
      t2,
      inP2,
      statusesOf: { p1: await workflow(p1.id), p2: await workflow(p2.id) },
    };
  }

  const taskRoutes = () =>
    api.tenantRoutes.filter((route) => route.includes('/tasks') || route.includes('/board'));

  it('covers every task route (a new one without a request makes this fail)', () => {
    expect([...taskRoutes()].sort()).toEqual(Object.keys(REQUESTS).sort());
  });

  it('CA-09: someone who does not participate gets the same body as for a missing task or project, on every route', async () => {
    const { base, p1, t1, t2, statusesOf } = await world();
    const done = statusesOf.p1.statuses[2]?.id ?? '';
    const visible: Target = {
      taskId: t1.id,
      key: t1.key,
      projectId: p1.id,
      statusId: done,
      otherTaskId: t2.id,
      otherUserId: users.participant,
    };
    const missing: Target = {
      ...visible,
      taskId: randomUUID(),
      key: 'WEB-999',
      projectId: randomUUID(),
    };

    for (const name of ['memberOutside', 'viewerOutside'] as const) {
      const actor = api.clientFor(users[name]);
      for (const route of taskRoutes()) {
        const request = REQUESTS[route];
        if (!request) throw new Error(`no request for ${route}`);
        const hidden = await request.send(actor, base, visible);
        const absent = await request.send(actor, base, missing);
        expect(comparable(hidden), `${route} › ${name}`).toEqual(comparable(absent));
        expect(comparable(hidden), `${route} › ${name}`).toMatchObject({
          status: 404,
          code: request.by === 'task' ? 'TASK_NOT_FOUND' : 'PROJECT_NOT_FOUND',
        });
      }
    }
  });

  it('RNF-01: a viewer participant gets 403 on every write before any state error; reads work', async () => {
    const { base, p1, t1, t2, statusesOf } = await world();
    const target: Target = {
      taskId: t1.id,
      key: t1.key,
      projectId: p1.id,
      statusId: statusesOf.p1.statuses[2]?.id ?? '',
      otherTaskId: t2.id,
      otherUserId: users.participant,
    };
    const actor = api.clientFor(users.viewerParticipant);

    for (const route of taskRoutes()) {
      const request = REQUESTS[route];
      if (!request) throw new Error(`no request for ${route}`);
      const response = await request.send(actor, base, target);
      if (request.kind === 'write') {
        expect(comparable(response), route).toMatchObject({
          status: 403,
          code: 'INSUFFICIENT_ROLE',
        });
      } else {
        expect(response.status, route).toBe(200);
      }
    }
  });

  it("D5: a member participant cannot delete someone else's task (403 before the version)", async () => {
    const { base, t1 } = await world();

    const response = await api
      .clientFor(users.participant)
      .delete(`${base}/tasks/${t1.id}?version=99`);

    expect(comparable(response)).toMatchObject({ status: 403, code: 'INSUFFICIENT_ROLE' });
  });

  it('IDOR between projects: parent, blocker, status, assignee and filters of P2 are refused in P1, even for the owner', async () => {
    const { organizationId, base, p1, p2, t1, inP2, statusesOf } = await world();
    // Status inicial de P2: é onde está `inP2` (um filtro sem projeto o vazaria).
    const p2Status = statusesOf.p2.statuses[0]?.id ?? '';
    const p2Ids = new Set([p2.id, inP2.id, ...statusesOf.p2.statuses.map((status) => status.id)]);
    const before = await api.prisma.task.findMany({ where: { organizationId, projectId: p2.id } });

    for (const name of ['manager', 'owner'] as const) {
      const actor = api.clientFor(users[name]);
      const responses: Array<[string, Response, number, string | null]> = [
        [
          'parent',
          await actor.post(`${base}/tasks`, {
            projectId: p1.id,
            title: 'X',
            parentTaskId: inP2.id,
          }),
          404,
          'TASK_NOT_FOUND',
        ],
        [
          'blocker',
          await actor.post(`${base}/tasks/${t1.id}/dependencies`, { blockingTaskId: inP2.id }),
          404,
          'TASK_NOT_FOUND',
        ],
        [
          'status',
          await actor.post(`${base}/tasks/${t1.id}/transition`, { statusId: p2Status, version: 1 }),
          404,
          'STATUS_NOT_FOUND',
        ],
        [
          'assignee',
          await actor.put(`${base}/tasks/${t1.id}/assignee`, {
            assigneeUserId: users.onlyInP2,
            version: 1,
          }),
          422,
          'ASSIGNEE_NOT_PROJECT_MEMBER',
        ],
        [
          'filter parentTaskId',
          await actor.get(`${base}/tasks?projectId=${p1.id}&parentTaskId=${inP2.id}`),
          200,
          null,
        ],
        [
          'filter statusId',
          await actor.get(`${base}/tasks?projectId=${p1.id}&statusId=${p2Status}`),
          200,
          null,
        ],
      ];
      for (const [label, response, status, code] of responses) {
        expect(response.status, `${label} › ${name}`).toBe(status);
        if (code) expect(problemDetailsSchema.parse(response.body).code, label).toBe(code);
        else expect(taskPageSchema.parse(response.body).items, label).toEqual([]);
        // Nenhum id de P2 que a própria requisição não tenha levado.
        const requested = new Set(response.request.url.match(/[0-9a-f-]{36}/g) ?? []);
        const leaked = (response.text.match(/[0-9a-f-]{36}/g) ?? []).filter(
          (value) => p2Ids.has(value) && !requested.has(value),
        );
        expect(leaked, `${label} › ${name}`).toEqual([]);
      }
    }
    expect(await api.prisma.task.findMany({ where: { organizationId, projectId: p2.id } })).toEqual(
      before,
    );
    // Spec 005: quadro e workflow com referências de P2 em P1, também para o owner.
    const owner = api.clientFor(users.owner);
    const p1Statuses = statusesOf.p1.statuses.map((status) => status.id);
    const spec005: Array<[string, Response, number, string]> = [
      [
        'column of P2 status',
        await owner.get(`${base}/board/columns/${p2Status}?projectId=${p1.id}`),
        404,
        'STATUS_NOT_FOUND',
      ],
      [
        'move to P2 status',
        await owner.post(`${base}/tasks/${t1.id}/move`, { toStatusId: p2Status, version: 1 }),
        404,
        'STATUS_NOT_FOUND',
      ],
      [
        'move after P2 card',
        await owner.post(`${base}/tasks/${t1.id}/move`, {
          toStatusId: p1Statuses[0],
          afterTaskId: inP2.id,
          version: 1,
        }),
        422,
        'INVALID_POSITION',
      ],
      [
        'reorder with P2 status',
        await owner.put(`${base}/projects/${p1.id}/workflow/order`, {
          statusIds: [...p1Statuses.slice(0, 2), p2Status],
          version: 1,
        }),
        404,
        'STATUS_NOT_FOUND',
      ],
      [
        'transition to P2 status',
        await owner.put(`${base}/projects/${p1.id}/workflow/transitions`, {
          transitions: [{ fromStatusId: p1Statuses[0], toStatusId: p2Status }],
          version: 1,
        }),
        404,
        'STATUS_NOT_FOUND',
      ],
      [
        'remove into P2 status',
        await owner.delete(
          `${base}/projects/${p1.id}/workflow/statuses/${p1Statuses[1] ?? ''}?version=1&moveTasksToStatusId=${p2Status}`,
        ),
        404,
        'STATUS_NOT_FOUND',
      ],
    ];
    for (const [label, response, status, errorCode] of spec005) {
      expect(response.status, label).toBe(status);
      expect(problemDetailsSchema.parse(response.body).code, label).toBe(errorCode);
    }
    expect(await api.prisma.workflowStatus.count({ where: { projectId: p1.id } })).toBe(3);

    // E o manager de P1 não enxerga P2 (não participa): 404 do projeto, não 403.
    const direct = await api.clientFor(users.manager).get(`${base}/tasks/${inP2.id}`);
    expect(comparable(direct)).toMatchObject({ status: 404, code: 'TASK_NOT_FOUND' });
  });
});
