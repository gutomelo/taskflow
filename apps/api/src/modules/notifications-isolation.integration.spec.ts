import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import type { PrismaClient } from '@taskflow/backend/shared/infrastructure';
import type { OrganizationRole } from '@taskflow/backend/shared/kernel';
import {
  notificationPageSchema,
  organizationSchema,
  problemDetailsSchema,
  projectSchema,
  taskSchema,
  unreadCountSchema,
} from '@taskflow/contracts';
import { startIntegrationApi, type IntegrationApi } from '../testing/integration-api';
import type { TestClient } from '../testing/isolation-cases';

/**
 * Spec 008, T9 (M4 da segurança): notificações são **pessoais** também dentro da organização.
 * Para owner, admin, member e viewer de A: lista e contador só com as próprias; marcar a de outra
 * pessoa ⇒ o mesmo 404 de um id inexistente; `read-all` não toca terceiros (conferido no banco);
 * a própria notificação de outra organização pelo caminho de A ⇒ 404. A bateria entre
 * organizações está em `organizations-isolation.integration.spec.ts` (casos declarados).
 */
describe('notifications are personal inside an organization (integration, spec 008 T9)', () => {
  let api: IntegrationApi;
  let prisma: PrismaClient;
  const people = {
    owner: randomUUID(),
    admin: randomUUID(),
    member: randomUUID(),
    viewer: randomUUID(),
  } as const;
  const roles = Object.keys(people) as Array<keyof typeof people>;

  beforeAll(async () => {
    api = await startIntegrationApi();
    prisma = api.prisma;
    for (const role of roles) api.addAccount(people[role], `${role}@exemplo.com`);
  });

  afterAll(async () => {
    await api?.stop();
  });

  const clientFor = (userId: string): TestClient => api.clientFor(userId);
  let w: Awaited<ReturnType<typeof world>>;

  // Um mundo só (criar organização tem limite por usuário); cada teste parte de tudo não lido.
  beforeAll(async () => {
    w = await world();
  });
  beforeEach(async () => {
    await prisma.notification.updateMany({ data: { readAt: null } });
  });

  async function at(pending: Promise<Response>, status: number): Promise<Response> {
    const response = await pending;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response;
  }

  /**
   * O 404 sem `requestId` (único por resposta) e `instance` (o próprio caminho pedido): o resto
   * precisa ser idêntico.
   */
  const shapeOf = (response: Response) => {
    const {
      requestId: _requestId,
      instance: _instance,
      ...rest
    } = problemDetailsSchema.parse(response.body);
    return rest;
  };

  /**
   * A com os quatro papéis, todos participantes do projeto; B com o member também. Uma
   * notificação de atribuição para cada pessoa em A e uma para o member em B.
   */
  async function world() {
    const owner = clientFor(people.owner);
    const createOrganization = async (slug: string) =>
      organizationSchema.parse(
        (await at(owner.post('/organizations', { name: `Org ${slug}`, slug }), 201)).body,
      ).id;
    const orgA = await createOrganization(`a-${randomUUID().slice(0, 8)}`);
    const orgB = await createOrganization(`b-${randomUUID().slice(0, 8)}`);
    const join = (organizationId: string, userId: string, role: OrganizationRole) =>
      prisma.membership.create({
        data: { id: randomUUID(), organizationId, userId, role, createdAt: new Date() },
      });
    await join(orgA, people.admin, 'admin');
    await join(orgA, people.member, 'member');
    await join(orgA, people.viewer, 'viewer');
    await join(orgB, people.member, 'member');

    const key = `N${randomUUID()
      .slice(0, 3)
      .toUpperCase()
      .replace(/[^A-Z]/g, 'Q')}`;
    const project = async (organizationId: string) => {
      const created = projectSchema.parse(
        (
          await at(
            owner.post(`/organizations/${organizationId}/projects`, { key, name: 'Notificações' }),
            201,
          )
        ).body,
      );
      return created.id;
    };
    const projectA = await project(orgA);
    const projectB = await project(orgB);
    for (const [organizationId, projectId, userId, role] of [
      [orgA, projectA, people.member, 'member'],
      [orgA, projectA, people.viewer, 'viewer'],
      [orgB, projectB, people.member, 'member'],
    ] as const) {
      await at(
        owner.post(`/organizations/${organizationId}/projects/${projectId}/members`, {
          userId,
          role,
        }),
        201,
      );
    }
    // A atribuição pela API grava o evento de integração na mesma transação (ADR 0017).
    const taskA = taskSchema.parse(
      (
        await at(
          owner.post(`/organizations/${orgA}/tasks`, {
            projectId: projectA,
            title: 'Tarefa de A',
            assigneeUserId: people.member,
          }),
          201,
        )
      ).body,
    );
    const taskB = taskSchema.parse(
      (
        await at(
          owner.post(`/organizations/${orgB}/tasks`, { projectId: projectB, title: 'Tarefa de B' }),
          201,
        )
      ).body,
    );

    // O worker não roda aqui: as notificações são semeadas direto.
    const notification = (
      organizationId: string,
      projectId: string,
      taskId: string,
      recipientUserId: string,
    ) => ({
      id: randomUUID(),
      organizationId,
      recipientUserId,
      kind: 'assignment' as const,
      actorUserId: people.owner,
      projectId,
      taskId,
      commentId: null,
      dedupeKey: `assignment:${randomUUID()}`,
      sourceEventId: randomUUID(),
      occurredAt: new Date(),
      createdAt: new Date(),
    });
    const inA = Object.fromEntries(
      roles.map((role) => [role, notification(orgA, projectA, taskA.id, people[role])]),
    ) as Record<keyof typeof people, ReturnType<typeof notification>>;
    const memberInB = notification(orgB, projectB, taskB.id, people.member);
    await prisma.notification.createMany({ data: [...Object.values(inA), memberInB] });
    return { orgA, orgB, taskA, inA, memberInB };
  }

  it('the HTTP assignment writes the integration event in the outbox (ADR 0017)', async () => {
    const { taskA } = w;

    const events = await prisma.outboxEvent.findMany({
      where: { type: 'tasks.assignee_changed' },
    });

    expect(events.map((event) => event.payload)).toContainEqual(
      expect.objectContaining({
        taskId: taskA.id,
        actorUserId: people.owner,
        assigneeUserId: people.member,
      }),
    );
  });

  it.each(roles)(
    "%s: lists and counts only their own; someone else's id is the same 404 as a missing one",
    async (role) => {
      const { orgA, inA } = w;
      const actor = clientFor(people[role]);
      const base = `/organizations/${orgA}/notifications`;

      const page = notificationPageSchema.parse((await at(actor.get(base), 200)).body);
      expect(page.items.map((item) => item.id)).toEqual([inA[role].id]);
      expect(
        unreadCountSchema.parse((await at(actor.get(`${base}/unread-count`), 200)).body),
      ).toEqual({ count: 1, capped: false });

      const missing = shapeOf(await at(actor.post(`${base}/${randomUUID()}/read`), 404));
      expect(missing.code).toBe('NOTIFICATION_NOT_FOUND');
      for (const other of roles.filter((candidate) => candidate !== role)) {
        expect(shapeOf(await at(actor.post(`${base}/${inA[other].id}/read`), 404))).toEqual(
          missing,
        );
        expect(
          shapeOf(await at(actor.post(`${base}/read-all`, { upToId: inA[other].id }), 404)),
        ).toEqual(missing);
      }
      expect(
        await prisma.notification.count({ where: { organizationId: orgA, readAt: { not: null } } }),
      ).toBe(0);
    },
  );

  it('read-all marks only the caller, in the active organization (checked in the database)', async () => {
    const { orgA, inA, memberInB } = w;

    await at(clientFor(people.member).post(`/organizations/${orgA}/notifications/read-all`), 204);

    const rows = await prisma.notification.findMany({
      where: { id: { in: [...Object.values(inA), memberInB].map((row) => row.id) } },
      select: { id: true, readAt: true },
    });
    const read = rows.filter((row) => row.readAt !== null).map((row) => row.id);
    expect(read).toEqual([inA.member.id]);
  });

  it("the caller's own notification of another organization is 404 under A's path", async () => {
    const { orgA, orgB, memberInB } = w;
    const member = clientFor(people.member);
    const base = `/organizations/${orgA}/notifications`;

    const missing = shapeOf(await at(member.post(`${base}/${randomUUID()}/read`), 404));
    expect(shapeOf(await at(member.post(`${base}/${memberInB.id}/read`), 404))).toEqual(missing);
    expect(
      shapeOf(await at(member.post(`${base}/read-all`, { upToId: memberInB.id }), 404)),
    ).toEqual(missing);
    expect(
      notificationPageSchema
        .parse((await at(member.get(base), 200)).body)
        .items.some((item) => item.id === memberInB.id),
    ).toBe(false);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: memberInB.id } })).readAt,
    ).toBeNull();
    // Pelo caminho certo, a mesma pessoa marca a sua.
    await at(member.post(`/organizations/${orgB}/notifications/${memberInB.id}/read`), 204);
  });
});
