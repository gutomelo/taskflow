import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import {
  commentSchema,
  mentionCandidatePageSchema,
  organizationSchema,
  problemDetailsSchema,
  projectSchema,
  taskSchema,
} from '@taskflow/contracts';
import { startIntegrationApi, type IntegrationApi } from '../testing/integration-api';
import type { TestClient } from '../testing/isolation-cases';
import type { RouteKey } from '../testing/tenant-isolation';

type Target = Readonly<{ taskId: string; commentId: string; mentionUserId: string }>;

/**
 * Requisição por rota de comentários. As de escrita usam dados que gerariam erro de **estado**
 * (versão velha, menção inválida) se a permissão fosse checada depois: 403 tem de vir antes.
 */
const REQUESTS: Readonly<
  Record<
    RouteKey,
    Readonly<{
      kind: 'read' | 'write';
      by: 'task' | 'comment';
      send: (actor: TestClient, base: string, target: Target) => Promise<Response>;
    }>
  >
> = {
  'GET /organizations/:organizationId/tasks/:taskId/comments': {
    kind: 'read',
    by: 'task',
    send: (actor, base, target) => actor.get(`${base}/tasks/${target.taskId}/comments`),
  },
  'POST /organizations/:organizationId/tasks/:taskId/comments': {
    kind: 'write',
    by: 'task',
    send: (actor, base, target) =>
      actor.post(`${base}/tasks/${target.taskId}/comments`, {
        body: `oi <@${target.mentionUserId}>`,
      }),
  },
  'GET /organizations/:organizationId/tasks/:taskId/mentionable-users': {
    kind: 'write',
    by: 'task',
    send: (actor, base, target) =>
      actor.get(`${base}/tasks/${target.taskId}/mentionable-users?query=a`),
  },
  'GET /organizations/:organizationId/comments/:commentId': {
    kind: 'read',
    by: 'comment',
    send: (actor, base, target) => actor.get(`${base}/comments/${target.commentId}`),
  },
  'PATCH /organizations/:organizationId/comments/:commentId': {
    kind: 'write',
    by: 'comment',
    send: (actor, base, target) =>
      actor.patch(`${base}/comments/${target.commentId}`, {
        body: `x <@${target.mentionUserId}>`,
        version: 99,
      }),
  },
  'DELETE /organizations/:organizationId/comments/:commentId': {
    kind: 'write',
    by: 'comment',
    send: (actor, base, target) => actor.delete(`${base}/comments/${target.commentId}?version=99`),
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

/** Spec 010, T8 (CA-06, CA-08): autorização de comentários dentro da organização, rotas reais. */
describe('comments authorization within the organization (integration, spec 010 T8)', () => {
  let api: IntegrationApi;
  const id = () => randomUUID();
  const users = {
    owner: id(),
    memberOutside: id(),
    viewerOutside: id(),
    manager: id(),
    participant: id(),
    otherParticipant: id(),
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

  /** P1 (manager; participant e otherParticipant members; viewerParticipant viewer) e P2 (owner; onlyInP2). */
  async function world() {
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
      [users.otherParticipant, 'member'],
      [users.viewerParticipant, 'viewer'],
      [users.onlyInP2, 'member'],
    ];
    for (const [userId, role] of roles) {
      await api.prisma.membership.create({
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
    for (const [userId, role] of [
      [users.participant, 'member'],
      [users.otherParticipant, 'member'],
      [users.viewerParticipant, 'viewer'],
    ] as const) {
      expect((await add(manager, p1.id, userId, role)).status).toBe(201);
    }
    expect((await add(owner, p2.id, users.onlyInP2, 'member')).status).toBe(201);
    const task = async (client: TestClient, projectId: string) =>
      taskSchema.parse((await client.post(`${base}/tasks`, { projectId, title: 'T' })).body);
    const comment = async (client: TestClient, taskId: string, body = 'oi') => {
      const response = await client.post(`${base}/tasks/${taskId}/comments`, { body });
      expect(response.status).toBe(201);
      return commentSchema.parse(response.body);
    };
    const t1 = await task(manager, p1.id);
    const inP2 = await task(owner, p2.id);
    return {
      organizationId,
      base,
      t1,
      inP2,
      ofParticipant: await comment(api.clientFor(users.participant), t1.id),
      ofManager: await comment(manager, t1.id),
      inP2Comment: await comment(owner, inP2.id),
    };
  }

  const commentRoutes = () =>
    api.tenantRoutes.filter(
      (route) => route.includes('/comments') || route.includes('/mentionable-users'),
    );

  it('covers every comment route (a new one without a request makes this fail)', () => {
    expect([...commentRoutes()].sort()).toEqual(Object.keys(REQUESTS).sort());
  });

  it('CA-08: someone who does not read the project gets the same body as for a missing task or comment', async () => {
    const { base, t1, ofParticipant } = await world();
    const visible: Target = {
      taskId: t1.id,
      commentId: ofParticipant.id,
      mentionUserId: users.participant,
    };
    const missing: Target = { ...visible, taskId: randomUUID(), commentId: randomUUID() };

    for (const name of ['memberOutside', 'viewerOutside', 'onlyInP2'] as const) {
      const actor = api.clientFor(users[name]);
      for (const route of commentRoutes()) {
        const request = REQUESTS[route];
        if (!request) throw new Error(`no request for ${route}`);
        const hidden = await request.send(actor, base, visible);
        const absent = await request.send(actor, base, missing);
        expect(comparable(hidden), `${route} › ${name}`).toEqual(comparable(absent));
        expect(comparable(hidden), `${route} › ${name}`).toMatchObject({
          status: 404,
          code: request.by === 'task' ? 'TASK_NOT_FOUND' : 'COMMENT_NOT_FOUND',
        });
      }
    }
  });

  it('CA-06: a viewer participant gets 403 on every write before any state error; reads work', async () => {
    const { base, t1, ofParticipant } = await world();
    const target: Target = {
      taskId: t1.id,
      commentId: ofParticipant.id,
      mentionUserId: users.onlyInP2,
    };
    const actor = api.clientFor(users.viewerParticipant);

    for (const route of commentRoutes()) {
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

  it("CA-05: a member cannot edit nor delete someone else's comment (403 before the version); a manager moderates", async () => {
    const { base, ofParticipant, ofManager } = await world();
    const other = api.clientFor(users.otherParticipant);

    for (const response of [
      await other.patch(`${base}/comments/${ofParticipant.id}`, { body: 'x', version: 99 }),
      await other.delete(`${base}/comments/${ofParticipant.id}?version=99`),
      await api.clientFor(users.participant).delete(`${base}/comments/${ofManager.id}?version=99`),
      await api
        .clientFor(users.manager)
        .patch(`${base}/comments/${ofParticipant.id}`, { body: 'x', version: 99 }),
    ]) {
      expect(comparable(response)).toMatchObject({ status: 403, code: 'INSUFFICIENT_ROLE' });
    }
    const moderated = await api
      .clientFor(users.manager)
      .delete(`${base}/comments/${ofParticipant.id}?version=1`);
    expect(moderated.status).toBe(204);
  });

  it('IDOR between projects: people and comments of P2 are refused in P1, even for the owner', async () => {
    const { organizationId, base, t1, inP2Comment } = await world();
    const before = await api.prisma.comment.findMany({ where: { organizationId } });

    for (const name of ['manager', 'owner'] as const) {
      const actor = api.clientFor(users[name]);
      const mention = await actor.post(`${base}/tasks/${t1.id}/comments`, {
        body: `oi <@${users.onlyInP2}>`,
      });
      expect(comparable(mention), name).toMatchObject({ status: 422, code: 'INVALID_MENTION' });
      const candidates = mentionCandidatePageSchema.parse(
        (await actor.get(`${base}/tasks/${t1.id}/mentionable-users?query=onlyInP2`)).body,
      );
      expect(candidates.items, name).toEqual([]);
    }
    // O manager de P1 não lê P2: o comentário de P2 não existe para ele.
    const hidden = await api.clientFor(users.manager).get(`${base}/comments/${inP2Comment.id}`);
    const absent = await api.clientFor(users.manager).get(`${base}/comments/${randomUUID()}`);
    expect(comparable(hidden)).toEqual(comparable(absent));
    expect(await api.prisma.comment.findMany({ where: { organizationId } })).toEqual(before);
  });
});
