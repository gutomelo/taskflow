import { as, createTasksWorld, forceCancel, forceStatus, WEB } from '../../testing/tasks-world';
import type { TasksTestbed } from '../../testing/tasks-fakes';
import { CreateTaskUseCase } from './create-task.use-case';
import { AssignTaskUseCase, UpdateTaskUseCase } from './edit-task.use-cases';

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: { code?: string }) => error.code,
  );

async function create(
  bed: TasksTestbed,
  input: Parameters<CreateTaskUseCase['execute']>[1],
  actor = 'mia',
) {
  return new CreateTaskUseCase(bed).execute(as(actor), input);
}

describe('UpdateTaskUseCase (RF-05)', () => {
  it('edits the fields, bumps the version and records the event', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'Antes' });
    bed.events.events = [];

    const updated = await new UpdateTaskUseCase(bed).execute(as('bia'), {
      taskId: task.id,
      title: 'Depois',
      description: 'linha 1\nlinha 2',
      priority: 'high',
      dueDate: '2026-12-31',
      version: 1,
    });

    expect(updated).toMatchObject({
      title: 'Depois',
      description: 'linha 1\nlinha 2',
      priority: 'high',
      dueDate: '2026-12-31',
      version: 2,
    });
    expect(bed.events.events).toEqual([
      expect.objectContaining({ type: 'tasks.updated', taskId: task.id, actorUserId: 'bia' }),
    ]);
    expect(bed.tasks.projectLocks).toEqual([]);
  });

  it('decides 404 → 403 → 409 archived → 409 canceled → 409 version', async () => {
    const { bed, web } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });
    const update = new UpdateTaskUseCase(bed);
    const command = { taskId: task.id, title: 'Y', version: 1 };

    expect(await code(update.execute(as('otto'), command))).toBe('TASK_NOT_FOUND');
    expect(await code(update.execute(as('mia'), { ...command, taskId: 'missing' }))).toBe(
      'TASK_NOT_FOUND',
    );
    expect(await code(update.execute(as('zoe', 'owner', 'org-b'), command))).toBe('TASK_NOT_FOUND');
    expect(await code(update.execute(as('vivi'), { ...command, version: 99 }))).toBe(
      'INSUFFICIENT_ROLE',
    );
    expect(await code(update.execute(as('mia'), { ...command, version: 99 }))).toBe(
      'VERSION_CONFLICT',
    );
    forceCancel(bed, task.id);
    expect(await code(update.execute(as('mia'), { ...command, version: 99 }))).toBe(
      'TASK_CANCELED',
    );
    web.archived = true;
    expect(await code(update.execute(as('vivi'), command))).toBe('INSUFFICIENT_ROLE');
    expect(await code(update.execute(as('mia'), command))).toBe('PROJECT_ARCHIVED');
  });

  it('an actor removed after the middleware gets the tenant 404', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });
    bed.projectAccess.setMember('org-a', 'bia', null);

    expect(
      await code(
        new UpdateTaskUseCase(bed).execute(as('bia', 'member'), {
          taskId: task.id,
          title: 'Y',
          version: 1,
        }),
      ),
    ).toBe('ORGANIZATION_NOT_FOUND');
  });

  describe('required flag (BR-001, D1, D4)', () => {
    async function family() {
      const world = createTasksWorld();
      const parent = await create(world.bed, { projectId: WEB, title: 'Pai' });
      const child = await create(world.bed, {
        projectId: WEB,
        title: 'Filha',
        parentTaskId: parent.id,
      });
      return { ...world, parent, child, update: new UpdateTaskUseCase(world.bed) };
    }

    it('toggles the flag under the project lock', async () => {
      const { bed, child, update } = await family();
      bed.tasks.projectLocks.length = 0;

      expect(
        (await update.execute(as('mia'), { taskId: child.id, isRequired: true, version: 1 }))
          .isRequired,
      ).toBe(true);
      expect(
        (await update.execute(as('mia'), { taskId: child.id, isRequired: false, version: 2 }))
          .isRequired,
      ).toBe(false);
      expect(bed.tasks.projectLocks).toEqual([WEB, WEB]);
    });

    it('D1: making a pending subtask required under a completed parent ⇒ PARENT_TASK_COMPLETED', async () => {
      const { bed, parent, child, update } = await family();
      forceStatus(bed, parent.id, 'web-done');

      expect(
        await code(update.execute(as('mia'), { taskId: child.id, isRequired: true, version: 1 })),
      ).toBe('PARENT_TASK_COMPLETED');
      forceStatus(bed, child.id, 'web-done');
      expect(
        await code(update.execute(as('mia'), { taskId: child.id, isRequired: true, version: 1 })),
      ).toBe('ok');
    });

    it('D4: a subtask blocked (even indirectly) by its parent cannot become required', async () => {
      const { bed, parent, child, update } = await family();
      const middle = await create(bed, { projectId: WEB, title: 'Meio' });
      await bed.dependencies.add('org-a', WEB, child.id, middle.id);
      await bed.dependencies.add('org-a', WEB, middle.id, parent.id);

      expect(
        await code(update.execute(as('mia'), { taskId: child.id, isRequired: true, version: 1 })),
      ).toBe('DEPENDENCY_CYCLE');
    });

    it('D4: the cycle may also close through another required subtask (implicit edge)', async () => {
      const { bed, parent, child, update } = await family();
      // child bloqueada por other; other é pai de grandchild obrigatória; grandchild bloqueada por parent.
      const other = await create(bed, { projectId: WEB, title: 'Outro pai' });
      const otherChild = await create(bed, {
        projectId: WEB,
        title: 'Obrigatória do outro',
        parentTaskId: other.id,
        isRequired: true,
      });
      await bed.dependencies.add('org-a', WEB, child.id, other.id);
      await bed.dependencies.add('org-a', WEB, otherChild.id, parent.id);

      expect(
        await code(update.execute(as('mia'), { taskId: child.id, isRequired: true, version: 1 })),
      ).toBe('DEPENDENCY_CYCLE');
    });

    it('a top-level task cannot be required', async () => {
      const { parent, update } = await family();

      expect(
        await code(update.execute(as('mia'), { taskId: parent.id, isRequired: true, version: 1 })),
      ).toBe('REQUIRED_WITHOUT_PARENT');
    });
  });
});

describe('AssignTaskUseCase (RF-06, BR-003)', () => {
  it('assigns and unassigns, rereading the assignee under lock', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });
    bed.events.events = [];
    const assign = new AssignTaskUseCase(bed);

    const assigned = await assign.execute(as('bia'), {
      taskId: task.id,
      assigneeUserId: 'adm',
      version: 1,
    });
    const unassigned = await assign.execute(as('bia'), {
      taskId: task.id,
      assigneeUserId: null,
      version: 2,
    });

    expect(assigned.assignee).toEqual({ userId: 'adm', name: 'ADM' });
    expect(unassigned).toMatchObject({ assignee: null, version: 3 });
    expect(bed.projectAccess.locks.slice(-2)).toEqual([
      { projectId: WEB, userIds: ['bia', 'adm'] },
      { projectId: WEB, userIds: ['bia'] },
    ]);
    expect(
      bed.events.events.map(
        (event) => event.type === 'tasks.assigned' && [event.fromUserId, event.toUserId],
      ),
    ).toEqual([
      [null, 'adm'],
      ['adm', null],
    ]);
  });

  it('the same assignee again changes nothing and records nothing', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X', assigneeUserId: 'bia' });
    bed.events.events = [];

    const view = await new AssignTaskUseCase(bed).execute(as('mia'), {
      taskId: task.id,
      assigneeUserId: 'bia',
      version: 1,
    });

    expect(view.version).toBe(1);
    expect(bed.events.events).toEqual([]);
  });

  it.each(['vivi', 'otto', 'ghost', 'zoe'])(
    'BR-003: %s cannot be the assignee',
    async (assigneeUserId) => {
      const { bed } = createTasksWorld();
      const task = await create(bed, { projectId: WEB, title: 'X' });

      expect(
        await code(
          new AssignTaskUseCase(bed).execute(as('mia'), {
            taskId: task.id,
            assigneeUserId,
            version: 1,
          }),
        ),
      ).toBe('ASSIGNEE_NOT_PROJECT_MEMBER');
    },
  );

  it('decides 403 before canceled, canceled before version', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });
    const assign = new AssignTaskUseCase(bed);
    forceCancel(bed, task.id);

    expect(
      await code(
        assign.execute(as('vivi'), { taskId: task.id, assigneeUserId: 'vivi', version: 9 }),
      ),
    ).toBe('INSUFFICIENT_ROLE');
    expect(
      await code(
        assign.execute(as('mia'), { taskId: task.id, assigneeUserId: 'vivi', version: 9 }),
      ),
    ).toBe('TASK_CANCELED');
  });
});
