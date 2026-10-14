import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import type { PrismaClient } from '@taskflow/backend/shared/infrastructure';
import {
  invitationPageSchema,
  memberPageSchema,
  myOrganizationListSchema,
  organizationSchema,
  problemDetailsSchema,
  projectMemberPageSchema,
  projectPageSchema,
  projectSchema,
  assignableUserPageSchema,
  taskPageSchema,
  taskSchema,
  workflowSchema,
} from '@taskflow/contracts';
import { startIntegrationApi, type IntegrationApi } from '../testing/integration-api';
import { ISOLATION_CASES, type IsolationWorld, type TestClient } from '../testing/isolation-cases';
import { concretePath, methodOf, pathParams } from '../testing/tenant-isolation';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * RNF-01 (spec 002) e RF-08/CA-07 (spec 006): a API real com PostgreSQL e a **mesma composição**
 * de `main.ts`. Para cada rota do escopo do tenant: (1) caso gerado — owner de A chama o prefixo
 * de B ⇒ 404; (2) variantes declaradas — ids reais de B sob o prefixo de A ⇒ 404 ou lista sem B.
 * Sempre: banco de B idêntico (todas as tabelas com `organization_id`) e nenhum id de B (canário)
 * em respostas de A.
 */
describe('tenant isolation over HTTP (integration, spec 002/T14 + spec 006/T6)', () => {
  let api: IntegrationApi;
  let prisma: PrismaClient;
  let tenantRoutes: ReadonlyArray<string>;
  // ana: owner de A; bob: owner de B; bia: membro só de B; dual: membro de A e de B; carol: membro só de A.
  const [ana, bob, bia, dual, carol] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];

  beforeAll(async () => {
    api = await startIntegrationApi();
    prisma = api.prisma;
    tenantRoutes = api.tenantRoutes;
    for (const [id, name] of [
      [ana, 'ana'],
      [bob, 'bob'],
      [bia, 'bia'],
      [dual, 'dual'],
      [carol, 'carol'],
    ] as const) {
      api.addAccount(id, `${name}@exemplo.com`);
    }
  });

  afterAll(async () => {
    await api?.stop();
  });

  const clientFor = (userId: string): TestClient => api.clientFor(userId);

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

  function addMembership(organizationId: string, userId: string) {
    return prisma.membership.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId,
        role: 'member',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  /** Cursor real de B: segunda página de uma lista de B (opaco, aponta para linhas de B). */
  async function cursorOf(response: Promise<Response>): Promise<string> {
    const body: unknown = (await response).body;
    const parsed = memberPageSchema
      .or(projectPageSchema)
      .or(projectMemberPageSchema)
      .or(invitationPageSchema)
      .or(taskPageSchema)
      .or(assignableUserPageSchema)
      .parse(body);
    if (!parsed.nextCursor) throw new Error('expected a second page in B');
    return parsed.nextCursor;
  }

  async function world(): Promise<IsolationWorld> {
    const asAna = clientFor(ana);
    const asBob = clientFor(bob);
    const asDual = clientFor(dual);
    const create = async (client: TestClient, slug: string) => {
      const response = await client.post('/organizations', { name: `Org ${slug}`, slug });
      expect(response.status).toBe(201);
      return organizationSchema.parse(response.body).id;
    };
    const createProject = async (client: TestClient, organizationId: string, key: string) => {
      const response = await client.post(`/organizations/${organizationId}/projects`, {
        key,
        name: `Projeto ${key}`,
      });
      expect(response.status, key).toBe(201);
      return projectSchema.parse(response.body);
    };
    const addParticipant = async (
      client: TestClient,
      organizationId: string,
      projectId: string,
      userId: string,
    ) => {
      const response = await client.post(
        `/organizations/${organizationId}/projects/${projectId}/members`,
        {
          userId,
          role: 'member',
        },
      );
      expect(response.status).toBe(201);
    };
    const suffix = randomUUID()
      .slice(0, 4)
      .toUpperCase()
      .replace(/[^A-Z]/g, 'Q');
    const orgA = await create(asAna, `a-${randomUUID().slice(0, 8)}`);
    const orgB = await create(asBob, `b-${randomUUID().slice(0, 8)}`);
    for (const invitee of ['convidada', 'outra']) {
      const invitation = await asBob.post(`/organizations/${orgB}/invitations`, {
        email: `${invitee}-${randomUUID().slice(0, 6)}@exemplo.com`,
        role: 'member',
      });
      expect(invitation.status).toBe(201);
    }
    const invitations = invitationPageSchema.parse(
      (await asBob.get(`/organizations/${orgB}/invitations`)).body,
    );
    await addMembership(orgB, bia);
    await addMembership(orgB, dual);
    await addMembership(orgA, dual);
    await addMembership(orgA, carol);

    // A: projeto do membro duplo (vira manager), com carol participante.
    const projectA = await createProject(asDual, orgA, `A${suffix}`);
    await addParticipant(asDual, orgA, projectA.id, carol);
    // B: dois projetos (cursor), com bia e o membro duplo participantes do primeiro.
    const projectB = await createProject(asBob, orgB, `B${suffix}`);
    await createProject(asBob, orgB, `C${suffix}`);
    await addParticipant(asBob, orgB, projectB.id, bia);
    await addParticipant(asBob, orgB, projectB.id, dual);

    // Spec 004: tarefa de A (do membro duplo); em B, duas tarefas (cursor), a primeira atribuída a
    // bia e bloqueada pela segunda.
    const createTask = async (client: TestClient, organizationId: string, body: object) => {
      const response = await client.post(`/organizations/${organizationId}/tasks`, body);
      expect(response.status).toBe(201);
      return taskSchema.parse(response.body);
    };
    const taskA = await createTask(asDual, orgA, { projectId: projectA.id, title: 'Tarefa de A' });
    const taskB = await createTask(asBob, orgB, {
      projectId: projectB.id,
      title: 'Tarefa de B',
      assigneeUserId: bia,
    });
    const blockerB = await createTask(asBob, orgB, {
      projectId: projectB.id,
      title: 'Bloqueadora',
    });
    expect(
      (
        await asBob.post(`/organizations/${orgB}/tasks/${taskB.id}/dependencies`, {
          blockingTaskId: blockerB.id,
        })
      ).status,
    ).toBe(201);
    const workflowB = workflowSchema.parse(
      (await asBob.get(`/organizations/${orgB}/projects/${projectB.id}/workflow`)).body,
    );

    return {
      orgA,
      orgB,
      ofA: {
        projectId: projectA.id,
        key: projectA.key,
        participantUserId: carol,
        taskId: taskA.id,
      },
      ofB: {
        userId: bia,
        invitationId: invitations.items[0]?.id ?? '',
        projectId: projectB.id,
        key: projectB.key,
        participantUserId: bia,
        membersCursor: await cursorOf(asBob.get(`/organizations/${orgB}/members?limit=1`)),
        projectsCursor: await cursorOf(asBob.get(`/organizations/${orgB}/projects?limit=1`)),
        projectMembersCursor: await cursorOf(
          asBob.get(`/organizations/${orgB}/projects/${projectB.id}/members?limit=1`),
        ),
        taskId: taskB.id,
        taskKey: taskB.key,
        blockingTaskId: blockerB.id,
        // Status inicial de B: é onde estão as tarefas de B (um filtro sem tenant as vazaria).
        statusId: workflowB.statuses[0]?.id ?? '',
        tasksCursor: await cursorOf(
          asBob.get(`/organizations/${orgB}/tasks?projectId=${projectB.id}&limit=1`),
        ),
        assignableCursor: await cursorOf(
          asBob.get(
            `/organizations/${orgB}/tasks/assignable-users?projectId=${projectB.id}&limit=1`,
          ),
        ),
      },
      asOwnerOfA: asAna,
      asDualMember: asDual,
      dualMemberUserId: dual,
    };
  }

  /** Ids de B que não podem aparecer em nenhuma resposta de A (canários). */
  async function canariesOf(
    organizationId: string,
    shared: ReadonlyArray<string>,
  ): Promise<Set<string>> {
    // Inclui ids de contas que só pertencem a B (bob, bia) e de projetos, status e participações
    // de B. Fora: quem pertence às duas organizações (aparece legitimamente em A).
    const ids = ((await snapshotOf(organizationId)).match(UUID) ?? []).map((id) =>
      id.toLowerCase(),
    );
    const excluded = new Set(shared.map((id) => id.toLowerCase()));
    return new Set(ids.filter((id) => !excluded.has(id)));
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
    if (method === 'put') return client.put(path, { version: 1 });
    if (method === 'delete') return client.delete(`${path}?version=1`);
    throw new Error(`unexpected method ${method}`);
  }

  it('CA-07: every tenant route answers 404 to the owner of A under the prefix of B (generated cases)', async () => {
    const setup = await world();
    const before = await snapshotOf(setup.orgB);
    const canaries = await canariesOf(setup.orgB, [setup.dualMemberUserId]);

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
    const canaries = await canariesOf(setup.orgB, [setup.dualMemberUserId]);

    const actors = [
      ['owner of A', setup.asOwnerOfA],
      ['member of A and B', setup.asDualMember],
    ] as const;
    for (const route of tenantRoutes) {
      for (const [reference, variant] of Object.entries(ISOLATION_CASES[route]?.references ?? {})) {
        for (const [actorName, actor] of actors) {
          if (variant.actors === 'owner-of-A' && actor !== setup.asOwnerOfA) continue;
          const response = await variant.call(setup, actor);
          const label = `${route} › ${reference} › ${actorName}`;
          if (variant.expect === 'not-found' || variant.expect === 'refused') {
            expect(response.status, label).toBe(variant.expect === 'not-found' ? 404 : 422);
            if (variant.code)
              expect(problemDetailsSchema.parse(response.body).code, label).toBe(variant.code);
          } else {
            expect(response.status, label).toBeLessThan(300);
          }
          expectNoLeak(response, canaries);
        }
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
