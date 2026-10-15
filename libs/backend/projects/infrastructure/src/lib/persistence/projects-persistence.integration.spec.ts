import { randomUUID } from 'node:crypto';
import {
  VersionConflictError,
  type OrganizationRole,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import {
  createPrismaClient,
  PrismaTransactionRunner,
  TransactionRequiredError,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import {
  AlreadyAProjectMemberError,
  defaultWorkflow,
  NotAnOrganizationMemberError,
  Project,
  ProjectKey,
  ProjectKeyTakenError,
  ProjectMember,
  ProjectName,
  StatusInUseError,
  StatusNameTakenError,
  type Workflow,
} from '@taskflow/backend/projects/domain';
import { PrismaProjectMemberRepository } from './prisma-project-member.repository';
import { PrismaProjectRepository } from './prisma-project.repository';

describe('projects persistence (integration, T3)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let projects: PrismaProjectRepository;
  let members: PrismaProjectMemberRepository;
  const now = new Date('2026-10-13T10:00:00.000Z');

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma);
    projects = new PrismaProjectRepository(transactions);
    members = new PrismaProjectMemberRepository(transactions);
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

  async function membership(
    organizationId: string,
    role: OrganizationRole = 'member',
    userId: string = randomUUID(),
  ) {
    await prisma.membership.create({
      data: { id: randomUUID(), organizationId, userId, role, createdAt: now },
    });
    return userId;
  }

  async function project(organizationId: string, key: string, name = key, archived = false) {
    const created = Project.create({
      id: randomUUID(),
      organizationId,
      key: ProjectKey.create(key),
      name: ProjectName.create(name),
      description: null,
      createdByUserId: randomUUID(),
      now,
    });
    if (archived) created.archive(now);
    await transactions.run(() => projects.add(created, defaultWorkflow(randomUUID)));
    return created.id;
  }

  function participation(
    organizationId: string,
    projectId: string,
    userId: string,
    role: ProjectRole = 'member',
  ) {
    return members.add(
      ProjectMember.create({
        id: randomUUID(),
        organizationId,
        projectId,
        userId,
        role,
        organizationRole: 'member',
        now,
      }),
    );
  }

  describe('projects', () => {
    it('BR-025: a repeated key in the organization becomes PROJECT_KEY_TAKEN', async () => {
      const organizationId = await organization();
      await project(organizationId, 'WEB');

      await expect(project(organizationId, 'WEB')).rejects.toBeInstanceOf(ProjectKeyTakenError);
    });

    it('stores the default workflow with the project', async () => {
      const organizationId = await organization();
      const projectId = await project(organizationId, 'WEB');

      const workflow = await projects.findWorkflow(organizationId, projectId);

      expect(workflow.statuses.map((status) => [status.name, status.category])).toEqual([
        ['A fazer', 'todo'],
        ['Em andamento', 'in_progress'],
        ['Concluído', 'done'],
      ]);
      expect(workflow.transitions).toHaveLength(4);
      expect(await projects.findWorkflow(await organization(), projectId)).toEqual({
        statuses: [],
        transitions: [],
      });
    });

    it('BR-023: finds a project only for those who see it, by id or key, in one organization', async () => {
      const [a, b] = [await organization(), await organization()];
      const projectId = await project(a, 'WEB');
      const participant = await membership(a);
      const outsider = await membership(a);
      await participation(a, projectId, participant, 'manager');

      expect(
        await projects.findVisible(a, { key: 'WEB' }, { userId: participant, seesAll: false }),
      ).toMatchObject({ participation: 'manager' });
      expect(
        await projects.findVisible(a, { projectId }, { userId: outsider, seesAll: false }),
      ).toBeNull();
      expect(
        await projects.findVisible(a, { projectId }, { userId: outsider, seesAll: true }),
      ).toMatchObject({ participation: null });
      expect(
        await projects.findVisible(b, { projectId }, { userId: outsider, seesAll: true }),
      ).toBeNull();
    });

    it('spec 008: finds many visible projects at once, only in the organization', async () => {
      const [a, b] = [await organization(), await organization()];
      const [web, app, foreign] = [
        await project(a, 'WEB'),
        await project(a, 'APP'),
        await project(b, 'WEB'),
      ];
      const participant = await membership(a);
      await participation(a, web, participant, 'viewer');
      const ids = [web, app, foreign];
      const found = async (seesAll: boolean) =>
        (await projects.findVisibleMany(a, ids, { userId: participant, seesAll }))
          .map((item) => [item.project.toSnapshot().key.value, item.participation])
          .sort();

      expect(await found(false)).toEqual([['WEB', 'viewer']]);
      expect(await found(true)).toEqual([
        ['APP', null],
        ['WEB', 'viewer'],
      ]);
      expect(await projects.findVisibleMany(a, [], { userId: participant, seesAll: true })).toEqual(
        [],
      );
    });

    it('lists visible projects by name, active or archived, page by page', async () => {
      const organizationId = await organization();
      const viewer = await membership(organizationId);
      const ids = [];
      for (const key of ['DELTA', 'ALFA', 'CHARLIE', 'BRAVO']) {
        ids.push(await project(organizationId, key));
      }
      await project(organizationId, 'ECHO', 'ECHO', true);
      await project(await organization(), 'AAA');
      for (const projectId of ids.slice(0, 3)) {
        await participation(organizationId, projectId, viewer);
      }
      const asViewer = { userId: viewer, seesAll: false };
      const list = (archived: boolean, cursor: string | null, seesAll = false) =>
        projects.listVisiblePage(
          organizationId,
          { viewer: { ...asViewer, seesAll }, archived },
          { limit: 2, cursor },
        );

      const first = await list(false, null);
      const second = await list(false, first.nextCursor);
      const names = (page: typeof first) =>
        page.items.map((item) => item.project.toSnapshot().name.value);

      expect(names(first)).toEqual(['ALFA', 'CHARLIE']);
      expect(names(second)).toEqual(['DELTA']);
      expect(second.nextCursor).toBeNull();
      expect(first.items[0]?.participation).toBe('member');
      expect(names(await list(false, null, true))).toEqual(['ALFA', 'BRAVO']);
      expect(names(await list(true, null, true))).toEqual(['ECHO']);
      expect(names(await list(false, 'not-a-cursor'))).toEqual(['ALFA', 'CHARLIE']);
      expect(await projects.countInOrganization(organizationId)).toBe(5);
    });

    it('BR-008: saves with the version read, and locks only inside a transaction', async () => {
      const organizationId = await organization();
      const projectId = await project(organizationId, 'WEB');

      await expect(projects.lockForUpdate(organizationId, projectId)).rejects.toBeInstanceOf(
        TransactionRequiredError,
      );
      const stale = await transactions.run(() => projects.lockForUpdate(organizationId, projectId));
      const fresh = await transactions.run(() => projects.lockForUpdate(organizationId, projectId));
      if (!stale || !fresh) throw new Error('project not found');
      fresh.archive(now);
      await projects.save(fresh);
      stale.update({ description: 'x' }, now);

      await expect(projects.save(stale)).rejects.toBeInstanceOf(VersionConflictError);
      const elsewhere = await organization();
      expect(await transactions.run(() => projects.lockForUpdate(elsewhere, projectId))).toBeNull();
      expect(
        (
          await transactions.run(() => projects.lockForUpdate(organizationId, projectId))
        )?.toSnapshot(),
      ).toMatchObject({ version: 2, archivedAt: now });
    });
  });

  describe('participations', () => {
    it('BR-027: refuses duplicates and users outside the organization', async () => {
      const [a, b] = [await organization(), await organization()];
      const projectId = await project(a, 'WEB');
      const userId = await membership(a);
      await participation(a, projectId, userId);

      await expect(participation(a, projectId, userId)).rejects.toBeInstanceOf(
        AlreadyAProjectMemberError,
      );
      await expect(participation(a, projectId, await membership(b))).rejects.toBeInstanceOf(
        NotAnOrganizationMemberError,
      );
    });

    it('finds, saves and removes a participation only within its own project (no IDOR)', async () => {
      const organizationId = await organization();
      const [p1, p2] = [await project(organizationId, 'WEB'), await project(organizationId, 'APP')];
      const userId = await membership(organizationId);
      await participation(organizationId, p2, userId);

      expect(await members.find(organizationId, p1, userId)).toBeNull();
      await expect(members.remove(organizationId, p1, userId, 1)).rejects.toBeInstanceOf(
        VersionConflictError,
      );
      const found = await members.find(organizationId, p2, userId);
      if (!found) throw new Error('participation not found');
      found.changeRole('viewer', 'member', now);
      await members.save(found);

      await expect(members.save(found)).rejects.toBeInstanceOf(VersionConflictError);
      await members.remove(organizationId, p2, userId, 2);
      expect(await members.count(organizationId, p2)).toBe(0);
    });

    it('pages participants by arrival and lists their user ids', async () => {
      const organizationId = await organization();
      const projectId = await project(organizationId, 'WEB');
      const users = [
        await membership(organizationId),
        await membership(organizationId),
        await membership(organizationId),
      ];
      for (const userId of users) await participation(organizationId, projectId, userId);

      const first = await members.listPage(organizationId, projectId, { limit: 2, cursor: null });
      const second = await members.listPage(organizationId, projectId, {
        limit: 2,
        cursor: first.nextCursor,
      });

      expect([...first.items, ...second.items].map((item) => item.userId)).toEqual(
        [...users].sort(),
      );
      expect(second.nextCursor).toBeNull();
      expect([...(await members.listUserIds(organizationId, projectId))].sort()).toEqual(
        [...users].sort(),
      );
    });

    it('BR-027: caps every participation of a user in the organization to viewer, bumping versions', async () => {
      const [a, b] = [await organization(), await organization()];
      const [p1, p2] = [await project(a, 'WEB'), await project(a, 'APP')];
      const userId = await membership(a);
      // O mesmo usuário também é membro de B e manager num projeto de B: B não é tocado.
      const projectOfB = await project(b, 'WEB');
      await membership(b, 'member', userId);
      await participation(b, projectOfB, userId, 'manager');
      const other = await membership(a);
      await participation(a, p1, userId, 'manager');
      await participation(a, p2, userId, 'viewer');
      await participation(a, p1, other, 'manager');

      await expect(members.capToViewer(a, userId, now)).rejects.toBeInstanceOf(
        TransactionRequiredError,
      );
      expect(await transactions.run(() => members.capToViewer(a, userId, now))).toBe(1);

      expect((await members.find(a, p1, userId))?.toSnapshot()).toMatchObject({
        role: 'viewer',
        version: 2,
      });
      expect((await members.find(a, p2, userId))?.toSnapshot()).toMatchObject({ version: 1 });
      expect((await members.find(a, p1, other))?.role).toBe('manager');
      expect((await members.find(b, projectOfB, userId))?.toSnapshot()).toMatchObject({
        role: 'manager',
        version: 1,
      });
    });
  });

  describe('workflow (spec 005, T4)', () => {
    const save = (organizationId: string, projectId: string, workflow: Workflow, version: number) =>
      transactions.run(() => projects.saveWorkflow(organizationId, projectId, workflow, version));

    it('saves the whole workflow with its own version: add, rename, reorder, transitions', async () => {
      const organizationId = await organization();
      const projectId = await project(organizationId, 'WEB');
      const current = await projects.findWorkflow(organizationId, projectId);
      const [todo, doing, done] = current.statuses.map((status) => status.id);
      if (!todo || !doing || !done) throw new Error('default workflow');
      const reviewId = randomUUID();
      const next: Workflow = {
        statuses: [
          { id: todo, name: 'Backlog', category: 'todo', position: 0 },
          { id: reviewId, name: 'Em revisão', category: 'in_progress', position: 1 },
          { id: doing, name: 'Em andamento', category: 'in_progress', position: 2 },
          { id: done, name: 'Concluído', category: 'done', position: 3 },
        ],
        transitions: [
          { fromStatusId: todo, toStatusId: doing },
          { fromStatusId: doing, toStatusId: reviewId },
          { fromStatusId: reviewId, toStatusId: done },
        ],
      };

      expect(await projects.workflowVersion(organizationId, projectId)).toBe(1);
      await save(organizationId, projectId, next, 1);

      const saved = await projects.findWorkflow(organizationId, projectId);
      expect(saved.statuses.map((status) => status.name)).toEqual([
        'Backlog',
        'Em revisão',
        'Em andamento',
        'Concluído',
      ]);
      expect(saved.transitions).toHaveLength(3);
      expect(await projects.workflowVersion(organizationId, projectId)).toBe(2);
      // `projects.version` (nome/descrição) não muda com o fluxo.
      expect(
        (
          await prisma.project.findUniqueOrThrow({
            where: { id: projectId },
            select: { version: true },
          })
        ).version,
      ).toBe(1);
      await expect(save(organizationId, projectId, next, 1)).rejects.toBeInstanceOf(
        VersionConflictError,
      );
      await expect(
        projects.saveWorkflow(organizationId, projectId, next, 2),
      ).rejects.toBeInstanceOf(TransactionRequiredError);
    });

    it('removes statuses (transitions in cascade); in use ⇒ STATUS_IN_USE; names without case ⇒ STATUS_NAME_TAKEN', async () => {
      const organizationId = await organization();
      const projectId = await project(organizationId, 'WEB');
      const current = await projects.findWorkflow(organizationId, projectId);
      const [todo, doing, done] = current.statuses;
      if (!todo || !doing || !done) throw new Error('default workflow');
      await prisma.task.create({
        data: {
          id: randomUUID(),
          organizationId,
          projectId,
          number: 1,
          title: 'Em uso',
          statusId: doing.id,
          createdByUserId: randomUUID(),
          createdAt: now,
          boardRank: 'a0',
        },
      });

      await expect(
        save(organizationId, projectId, { statuses: [todo, done], transitions: [] }, 1),
      ).rejects.toBeInstanceOf(StatusInUseError);
      await expect(
        save(
          organizationId,
          projectId,
          { statuses: [todo, { ...doing, name: 'A FAZER' }, done], transitions: [] },
          1,
        ),
      ).rejects.toBeInstanceOf(StatusNameTakenError);
      await save(
        organizationId,
        projectId,
        {
          statuses: [todo, doing],
          transitions: current.transitions.filter(
            (t) => t.toStatusId !== done.id && t.fromStatusId !== done.id,
          ),
        },
        1,
      );

      const saved = await projects.findWorkflow(organizationId, projectId);
      expect(saved.statuses.map((status) => status.id)).toEqual([todo.id, doing.id]);
      expect(
        saved.transitions.every((t) => t.fromStatusId !== done.id && t.toStatusId !== done.id),
      ).toBe(true);
    });

    it('never touches another organization or project', async () => {
      const [a, b] = [await organization(), await organization()];
      const [mine, theirs] = [await project(a, 'WEB'), await project(b, 'WEB')];
      const foreign = await projects.findWorkflow(b, theirs);

      expect(await projects.workflowVersion(a, theirs)).toBeNull();
      await expect(save(a, theirs, foreign, 1)).rejects.toBeInstanceOf(VersionConflictError);
      // Ids de status de B num workflow de A: as escritas filtram (org, projeto, id) e não tocam B.
      const renamedForeign: Workflow = {
        statuses: foreign.statuses.map((status) => ({ ...status, name: `${status.name} X` })),
        transitions: [],
      };
      await expect(save(a, mine, renamedForeign, 1)).rejects.toThrow();
      expect(await projects.findWorkflow(b, theirs)).toEqual(foreign);
    });
  });
});
