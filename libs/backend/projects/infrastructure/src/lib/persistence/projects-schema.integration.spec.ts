import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';

/**
 * Restrições do banco da spec 003 (T2): o domínio valida as regras; estas provas garantem que o
 * banco recusa o que escaparia dele (CHECKs, unicidade, FKs compostas e a FK do ADR 0015).
 */
describe('projects schema (integration, T2)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  const now = new Date();

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE organizations CASCADE`;
  });

  async function organization() {
    const id = randomUUID();
    await prisma.organization.create({
      data: { id, name: 'Acme', slug: `org-${id.slice(0, 8)}`, createdAt: now },
    });
    return id;
  }

  async function membership(organizationId: string, userId = randomUUID()) {
    await prisma.membership.create({
      data: { id: randomUUID(), organizationId, userId, role: 'member', createdAt: now },
    });
    return userId;
  }

  async function project(organizationId: string, key = 'WEB', archivedAt: Date | null = null) {
    const id = randomUUID();
    await prisma.project.create({
      data: {
        id,
        organizationId,
        key,
        name: 'Website',
        archivedAt,
        createdByUserId: randomUUID(),
        createdAt: now,
      },
    });
    return id;
  }

  function participation(organizationId: string, projectId: string, userId: string) {
    return prisma.projectMember.create({
      data: { id: randomUUID(), organizationId, projectId, userId, role: 'member', createdAt: now },
    });
  }

  function status(organizationId: string, projectId: string, position: number) {
    return prisma.workflowStatus.create({
      data: {
        id: randomUUID(),
        organizationId,
        projectId,
        name: `S${position}`,
        category: 'todo',
        position,
      },
    });
  }

  it('BR-025: the key format is enforced by the database', async () => {
    const organizationId = await organization();

    for (const key of ['web', '1AB', 'A', 'WE-B']) {
      await expect(project(organizationId, key)).rejects.toThrow(/projects_key_format/);
    }
    await expect(project(organizationId, 'Q2025')).resolves.toBeTypeOf('string');
  });

  it('BR-025: a key is unique within the organization, archived projects included', async () => {
    const [a, b] = [await organization(), await organization()];
    await project(a, 'WEB', new Date());

    await expect(project(a, 'WEB')).rejects.toMatchObject({ code: 'P2002' });
    await expect(project(b, 'WEB')).resolves.toBeTypeOf('string');
  });

  it('ADR 0015: a project belongs to an existing organization and goes away with it', async () => {
    await expect(project(randomUUID())).rejects.toMatchObject({ code: 'P2003' });
    const organizationId = await organization();
    await project(organizationId);

    await prisma.organization.delete({ where: { id: organizationId } });

    expect(await prisma.project.count()).toBe(0);
  });

  it('BR-027 / ADR 0015: only members of the organization participate', async () => {
    const [a, b] = [await organization(), await organization()];
    const projectId = await project(a);
    const memberOfB = await membership(b);

    await expect(participation(a, projectId, randomUUID())).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(participation(a, projectId, memberOfB)).rejects.toMatchObject({ code: 'P2003' });
  });

  it('BR-027 / ADR 0015: removing the membership deletes the participations', async () => {
    const organizationId = await organization();
    const [p1, p2] = [await project(organizationId, 'WEB'), await project(organizationId, 'APP')];
    const userId = await membership(organizationId);
    const other = await membership(organizationId);
    await participation(organizationId, p1, userId);
    await participation(organizationId, p2, userId);
    await participation(organizationId, p1, other);

    await prisma.membership.deleteMany({ where: { organizationId, userId } });

    expect(
      await prisma.projectMember.findMany({ where: { organizationId }, select: { userId: true } }),
    ).toEqual([{ userId: other }]);
  });

  it('a participation cannot point to a project of another organization', async () => {
    const [a, b] = [await organization(), await organization()];
    const projectOfB = await project(b);
    const memberOfA = await membership(a);

    await expect(participation(a, projectOfB, memberOfA)).rejects.toMatchObject({ code: 'P2003' });
  });

  it('BR-004: a transition only links two different statuses of the same project', async () => {
    const organizationId = await organization();
    const [p1, p2] = [await project(organizationId, 'WEB'), await project(organizationId, 'APP')];
    const [s1, s2] = [await status(organizationId, p1, 0), await status(organizationId, p1, 1)];
    const elsewhere = await status(organizationId, p2, 0);
    const transition = (fromStatusId: string, toStatusId: string) =>
      prisma.workflowTransition.create({
        data: { organizationId, projectId: p1, fromStatusId, toStatusId },
      });

    await expect(transition(s1.id, s2.id)).resolves.toBeDefined();
    await expect(transition(s1.id, elsewhere.id)).rejects.toMatchObject({ code: 'P2003' });
    await expect(transition(s1.id, s1.id)).rejects.toThrow(
      /workflow_transitions_distinct_statuses/,
    );
  });

  it('deleting a project removes its participations and workflow', async () => {
    const organizationId = await organization();
    const projectId = await project(organizationId);
    await participation(organizationId, projectId, await membership(organizationId));
    const [s1, s2] = [
      await status(organizationId, projectId, 0),
      await status(organizationId, projectId, 1),
    ];
    await prisma.workflowTransition.create({
      data: { organizationId, projectId, fromStatusId: s1.id, toStatusId: s2.id },
    });

    await prisma.project.delete({ where: { id: projectId } });

    expect(await prisma.projectMember.count()).toBe(0);
    expect(await prisma.workflowStatus.count()).toBe(0);
    expect(await prisma.workflowTransition.count()).toBe(0);
  });
});
