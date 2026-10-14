import { RateLimitedError } from '@taskflow/backend/shared/application';
import { as, createTasksWorld, forceStatus, APP, B_WEB, WEB } from '../../testing/tasks-world';
import { TASK_CREATION_POLICY } from '../shared/task-limits';
import { CreateTaskUseCase } from './create-task.use-case';

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: { code?: string; name?: string }) => error.code ?? error.name,
  );

describe('CreateTaskUseCase (RF-01, RF-02)', () => {
  it('BR-028: tasks start in the first todo status, without priority, numbered per project', async () => {
    const { bed } = createTasksWorld();
    const create = new CreateTaskUseCase(bed);

    const first = await create.execute(as('mia'), { projectId: WEB, title: '  Login  ' });
    const second = await create.execute(as('bia'), { projectId: WEB, title: 'Cadastro' });
    const other = await create.execute(as('bia'), { projectId: APP, title: 'Outro projeto' });

    expect(first).toMatchObject({
      key: 'WEB-1',
      number: 1,
      title: 'Login',
      status: { id: 'web-todo', category: 'todo' },
      priority: 'none',
      assignee: null,
      version: 1,
      subtasks: [],
      blockedBy: [],
      blocking: [],
      actions: { update: true, delete: true, transitionTo: ['web-doing'] },
    });
    expect(second.key).toBe('WEB-2');
    expect(other.key).toBe('APP-1');
    expect(bed.events.events.map((event) => [event.type, event.taskId])).toEqual([
      ['tasks.created', first.id],
      ['tasks.created', second.id],
      ['tasks.created', other.id],
    ]);
  });

  it('BR-028: numbers are never reused after a deletion', async () => {
    const { bed } = createTasksWorld();
    const create = new CreateTaskUseCase(bed);
    await create.execute(as('mia'), { projectId: WEB, title: 'Um' });
    const second = await create.execute(as('mia'), { projectId: WEB, title: 'Dois' });
    await bed.tasks.remove('org-a', WEB, second.id, 1);

    expect((await create.execute(as('mia'), { projectId: WEB, title: 'Três' })).key).toBe('WEB-3');
  });

  it('decides 404 → 403 → 409: hidden project, viewer, archived project', async () => {
    const { bed, web } = createTasksWorld();
    const create = new CreateTaskUseCase(bed);
    const command = { projectId: WEB, title: 'Tarefa' };

    expect(await code(create.execute(as('otto'), command))).toBe('PROJECT_NOT_FOUND');
    expect(await code(create.execute(as('bia'), { ...command, projectId: B_WEB }))).toBe(
      'PROJECT_NOT_FOUND',
    );
    expect(await code(create.execute(as('bia'), { ...command, projectId: 'missing' }))).toBe(
      'PROJECT_NOT_FOUND',
    );
    web.archived = true;
    expect(await code(create.execute(as('vivi'), command))).toBe('INSUFFICIENT_ROLE');
    expect(await code(create.execute(as('mia'), command))).toBe('PROJECT_ARCHIVED');
    expect(bed.tasks.rows).toEqual([]);
    expect(bed.events.events).toEqual([]);
  });

  it('an actor removed from the organization after the middleware gets the tenant 404', async () => {
    const { bed } = createTasksWorld();
    bed.projectAccess.setMember('org-a', 'bia', null);

    expect(
      await code(
        new CreateTaskUseCase(bed).execute(as('bia', 'member'), { projectId: WEB, title: 'X' }),
      ),
    ).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('locks the project and the people involved for share', async () => {
    const { bed } = createTasksWorld();

    await new CreateTaskUseCase(bed).execute(as('mia'), {
      projectId: WEB,
      title: 'Com responsável',
      assigneeUserId: 'bia',
    });

    expect(bed.projectAccess.locks).toEqual([{ projectId: WEB, userIds: ['mia', 'bia'] }]);
    expect(bed.tasks.projectLocks).toEqual([]);
  });

  describe('BR-003: assignee on creation', () => {
    it('accepts a member participant and an owner who does not participate', async () => {
      const { bed } = createTasksWorld();
      const create = new CreateTaskUseCase(bed);

      const toBia = await create.execute(as('mia'), {
        projectId: WEB,
        title: 'A',
        assigneeUserId: 'bia',
      });
      const toAna = await create.execute(as('bia'), {
        projectId: WEB,
        title: 'B',
        assigneeUserId: 'ana',
      });

      expect(toBia.assignee).toEqual({ userId: 'bia', name: 'BIA' });
      expect(toAna.assignee).toEqual({ userId: 'ana', name: 'ANA' });
      expect(bed.events.events.filter((event) => event.type === 'tasks.assigned')).toHaveLength(2);
    });

    it.each([
      ['a viewer', 'vivi'],
      ['a member without participation', 'otto'],
      ['an unknown user', 'ghost'],
      ['a member of another organization', 'zoe'],
    ])('rejects %s with ASSIGNEE_NOT_PROJECT_MEMBER', async (_label, assigneeUserId) => {
      const { bed } = createTasksWorld();

      expect(
        await code(
          new CreateTaskUseCase(bed).execute(as('mia'), {
            projectId: WEB,
            title: 'X',
            assigneeUserId,
          }),
        ),
      ).toBe('ASSIGNEE_NOT_PROJECT_MEMBER');
      expect(bed.tasks.counters.size).toBe(0);
    });
  });

  describe('subtasks (RF-02, BR-001)', () => {
    it('creates a required subtask under the project lock', async () => {
      const { bed } = createTasksWorld();
      const create = new CreateTaskUseCase(bed);
      const parent = await create.execute(as('mia'), { projectId: WEB, title: 'Pai' });

      const child = await create.execute(as('bia'), {
        projectId: WEB,
        title: 'Filha',
        parentTaskId: parent.id,
        isRequired: true,
      });

      expect(child).toMatchObject({ key: 'WEB-2', parentTaskId: parent.id, isRequired: true });
      expect(bed.tasks.projectLocks).toEqual([WEB]);
    });

    it('rejects a second level, a parent of another project and required without parent', async () => {
      const { bed } = createTasksWorld();
      const create = new CreateTaskUseCase(bed);
      const parent = await create.execute(as('mia'), { projectId: WEB, title: 'Pai' });
      const child = await create.execute(as('mia'), {
        projectId: WEB,
        title: 'Filha',
        parentTaskId: parent.id,
      });
      const elsewhere = await create.execute(as('bia'), { projectId: APP, title: 'Em APP' });

      expect(
        await code(
          create.execute(as('mia'), { projectId: WEB, title: 'Neta', parentTaskId: child.id }),
        ),
      ).toBe('SUBTASK_DEPTH');
      expect(
        await code(
          create.execute(as('mia'), { projectId: WEB, title: 'X', parentTaskId: elsewhere.id }),
        ),
      ).toBe('TASK_NOT_FOUND');
      expect(
        await code(create.execute(as('mia'), { projectId: WEB, title: 'X', isRequired: true })),
      ).toBe('REQUIRED_WITHOUT_PARENT');
    });

    it('D1 (BR-001): a completed parent cannot get a required subtask, an optional one is fine', async () => {
      const { bed } = createTasksWorld();
      const create = new CreateTaskUseCase(bed);
      const parent = await create.execute(as('mia'), { projectId: WEB, title: 'Pai' });
      forceStatus(bed, parent.id, 'web-done');

      expect(
        await code(
          create.execute(as('mia'), {
            projectId: WEB,
            title: 'X',
            parentTaskId: parent.id,
            isRequired: true,
          }),
        ),
      ).toBe('PARENT_TASK_COMPLETED');
      expect(
        await code(
          create.execute(as('mia'), { projectId: WEB, title: 'Y', parentTaskId: parent.id }),
        ),
      ).toBe('ok');
    });

    it('RNF-05: at most 100 subtasks per task', async () => {
      const { bed } = createTasksWorld();
      const create = new CreateTaskUseCase(bed);
      const parent = await create.execute(as('mia'), { projectId: WEB, title: 'Pai' });
      for (let index = 0; index < 100; index += 1) {
        await create.execute(as('mia'), {
          projectId: WEB,
          title: `F${index}`,
          parentTaskId: parent.id,
        });
      }

      expect(
        await code(
          create.execute(as('mia'), { projectId: WEB, title: 'Demais', parentTaskId: parent.id }),
        ),
      ).toBe('SUBTASK_LIMIT_REACHED');
    });
  });

  describe('RNF-05 limits', () => {
    it('stops at 10 000 numbers per project, counting deleted tasks, and rolls the number back', async () => {
      const { bed } = createTasksWorld();
      bed.tasks.counters.set(`org-a|${WEB}`, 10_001);

      expect(
        await code(new CreateTaskUseCase(bed).execute(as('mia'), { projectId: WEB, title: 'X' })),
      ).toBe('TASK_LIMIT_REACHED');
      expect(bed.tasks.counters.get(`org-a|${WEB}`)).toBe(10_001);
    });

    it('the 10 000th number is still accepted', async () => {
      const { bed } = createTasksWorld();
      bed.tasks.counters.set(`org-a|${WEB}`, 10_000);

      expect(
        (await new CreateTaskUseCase(bed).execute(as('mia'), { projectId: WEB, title: 'X' }))
          .number,
      ).toBe(10_000);
    });

    it('stops at 100 000 tasks per organization', async () => {
      const { bed } = createTasksWorld();
      bed.tasks.countInOrganization = async () => 100_000;

      expect(
        await code(new CreateTaskUseCase(bed).execute(as('mia'), { projectId: WEB, title: 'X' })),
      ).toBe('TASK_LIMIT_REACHED');
    });

    it('counts every attempt against tasks.create.user.hour, even refused ones', async () => {
      const { bed } = createTasksWorld();
      bed.rateLimiter.consumed.set(`${TASK_CREATION_POLICY.name}|vivi`, 299);
      const create = new CreateTaskUseCase(bed);

      expect(await code(create.execute(as('vivi'), { projectId: WEB, title: 'X' }))).toBe(
        'INSUFFICIENT_ROLE',
      );
      await expect(
        create.execute(as('vivi'), { projectId: WEB, title: 'X' }),
      ).rejects.toBeInstanceOf(RateLimitedError);
    });
  });

  it('the core runs in the caller transaction and leaves the events to it', async () => {
    const { bed } = createTasksWorld();

    const outcome = await bed.transactions.run(() =>
      new CreateTaskUseCase(bed).createWithinTransaction(as('mia'), { projectId: WEB, title: 'X' }),
    );

    expect(outcome.events.map((event) => event.type)).toEqual(['tasks.created']);
    expect(bed.events.events).toEqual([]);
    await expect(
      new CreateTaskUseCase(bed).createWithinTransaction(as('mia'), { projectId: WEB, title: 'Y' }),
    ).rejects.toThrow(/inside a transaction/);
  });
});
