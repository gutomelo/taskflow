import { ConcurrentUpdateError } from '@taskflow/backend/shared/application';
import { as, createTasksWorld, forceCancel, forceStatus, WEB } from '../../testing/tasks-world';
import type { TasksTestbed } from '../../testing/tasks-fakes';
import { CreateTaskUseCase } from './create-task.use-case';
import { AddDependencyUseCase, RemoveDependencyUseCase } from './task-dependency.use-cases';
import { AssignTaskUseCase, UpdateTaskUseCase } from './edit-task.use-cases';
import { GetTaskUseCase } from './task-queries.use-cases';
import {
  CancelTaskUseCase,
  DeleteTaskUseCase,
  ReopenTaskUseCase,
  TransitionTaskUseCase,
} from './task-lifecycle.use-cases';

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: { code?: string }) => error.code,
  );
const idsOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { taskIds?: ReadonlyArray<string> }) => error.taskIds,
  );

async function create(
  bed: TasksTestbed,
  input: Parameters<CreateTaskUseCase['execute']>[1],
  actor = 'mia',
) {
  return new CreateTaskUseCase(bed).execute(as(actor), input);
}
const versionOf = (bed: TasksTestbed, taskId: string) =>
  bed.tasks.rows.find((row) => row.id === taskId)?.version ?? 0;

function move(bed: TasksTestbed, taskId: string, statusId: string, actor = 'mia') {
  return new TransitionTaskUseCase(bed).execute(as(actor), {
    taskId,
    statusId,
    version: versionOf(bed, taskId),
  });
}

describe('TransitionTaskUseCase (RF-07, CA-03)', () => {
  it('BR-004: only workflow transitions; done records and clears the completion', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });
    bed.events.events = [];

    expect(await code(move(bed, task.id, 'web-done'))).toBe('TRANSITION_NOT_ALLOWED');
    expect(await code(move(bed, task.id, 'web-todo'))).toBe('TRANSITION_NOT_ALLOWED');
    await move(bed, task.id, 'web-doing');
    const done = await move(bed, task.id, 'web-done', 'bia');
    expect(done).toMatchObject({
      status: { id: 'web-done' },
      version: 3,
      actions: { transitionTo: ['web-doing'] },
    });
    expect(done.completedAt).toEqual(bed.clock.now());
    expect(bed.tasks.rows[0]?.completedByUserId).toBe('bia');
    expect((await move(bed, task.id, 'web-doing')).completedAt).toBeNull();
    expect(
      bed.events.events.map((event) => event.type === 'tasks.status_changed' && event.toStatusId),
    ).toEqual(['web-doing', 'web-done', 'web-doing']);
  });

  it('locks the project in tasks only when entering or leaving done', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });

    await move(bed, task.id, 'web-doing');
    expect(bed.tasks.projectLocks).toEqual([]);
    await move(bed, task.id, 'web-done');
    await move(bed, task.id, 'web-doing');
    expect(bed.tasks.projectLocks).toEqual([WEB, WEB]);
  });

  it('a status of another project ⇒ STATUS_NOT_FOUND (after version)', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });
    const transition = new TransitionTaskUseCase(bed);

    expect(
      await code(
        transition.execute(as('mia'), { taskId: task.id, statusId: 'app-doing', version: 1 }),
      ),
    ).toBe('STATUS_NOT_FOUND');
    expect(
      await code(
        transition.execute(as('mia'), { taskId: task.id, statusId: 'app-doing', version: 7 }),
      ),
    ).toBe('VERSION_CONFLICT');
  });

  it('a task that entered done between the read and the lock ⇒ CONCURRENT_UPDATE', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });
    await move(bed, task.id, 'web-doing');
    const lockById = bed.tasks.lockById.bind(bed.tasks);
    bed.tasks.lockById = async (organizationId, projectId, taskId) => {
      forceStatus(bed, taskId, 'web-done'); // outra transação concluiu no meio
      return lockById(organizationId, projectId, taskId);
    };

    await expect(
      new TransitionTaskUseCase(bed).execute(as('mia'), {
        taskId: task.id,
        statusId: 'web-todo',
        version: 2,
      }),
    ).rejects.toBeInstanceOf(ConcurrentUpdateError);
  });

  describe('BR-001 (CA-02)', () => {
    it('required pending subtasks block the completion; optional and canceled ones do not', async () => {
      const { bed } = createTasksWorld();
      const parent = await create(bed, { projectId: WEB, title: 'Pai' });
      const required = await create(bed, {
        projectId: WEB,
        title: 'Obrigatória',
        parentTaskId: parent.id,
        isRequired: true,
      });
      await create(bed, { projectId: WEB, title: 'Opcional', parentTaskId: parent.id });
      await move(bed, parent.id, 'web-doing');

      expect(await code(move(bed, parent.id, 'web-done'))).toBe(
        'TASK_HAS_PENDING_REQUIRED_SUBTASKS',
      );
      expect(await idsOf(move(bed, parent.id, 'web-done'))).toEqual([required.id]);
      await new CancelTaskUseCase(bed).execute(as('mia'), { taskId: required.id, version: 1 });
      expect(await code(move(bed, parent.id, 'web-done'))).toBe('ok');
    });

    it('D1: a required subtask cannot leave done while its parent is completed', async () => {
      const { bed } = createTasksWorld();
      const parent = await create(bed, { projectId: WEB, title: 'Pai' });
      const child = await create(bed, {
        projectId: WEB,
        title: 'Filha',
        parentTaskId: parent.id,
        isRequired: true,
      });
      forceStatus(bed, child.id, 'web-done');
      forceStatus(bed, parent.id, 'web-done');

      expect(await code(move(bed, child.id, 'web-doing'))).toBe('PARENT_TASK_COMPLETED');
      await move(bed, parent.id, 'web-doing');
      expect(await code(move(bed, child.id, 'web-doing'))).toBe('ok');
    });
  });

  describe('BR-006 (CA-04)', () => {
    it('pending blockers prevent the completion; done or canceled ones do not', async () => {
      const { bed } = createTasksWorld();
      const blocked = await create(bed, { projectId: WEB, title: 'Bloqueada' });
      const first = await create(bed, { projectId: WEB, title: 'B1' });
      const second = await create(bed, { projectId: WEB, title: 'B2' });
      const add = new AddDependencyUseCase(bed);
      await add.execute(as('mia'), { taskId: blocked.id, blockingTaskId: first.id });
      await add.execute(as('mia'), { taskId: blocked.id, blockingTaskId: second.id });
      await move(bed, blocked.id, 'web-doing');

      expect(await idsOf(move(bed, blocked.id, 'web-done'))).toEqual([first.id, second.id]);
      forceStatus(bed, first.id, 'web-done');
      forceCancel(bed, second.id);
      expect(await code(move(bed, blocked.id, 'web-done'))).toBe('ok');
    });

    it('D2: reopening a blocker does not undo a completion', async () => {
      const { bed } = createTasksWorld();
      const blocked = await create(bed, { projectId: WEB, title: 'Bloqueada' });
      const blocker = await create(bed, { projectId: WEB, title: 'Bloqueadora' });
      forceStatus(bed, blocked.id, 'web-done');

      await new AddDependencyUseCase(bed).execute(as('mia'), {
        taskId: blocked.id,
        blockingTaskId: blocker.id,
      });

      expect(bed.tasks.rows.find((row) => row.id === blocked.id)?.completedAt).not.toBeNull();
    });
  });
});

describe('CancelTask / ReopenTask (RF-09, BR-029, CA-06)', () => {
  it('cancels and reopens, idempotently, with events and the project lock', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' }, 'bia');
    bed.events.events = [];
    const cancel = new CancelTaskUseCase(bed);
    const reopen = new ReopenTaskUseCase(bed);

    const canceled = await cancel.execute(as('bia'), { taskId: task.id, version: 1 });
    expect(canceled).toMatchObject({
      version: 2,
      actions: { update: false, assign: false, cancel: false, reopen: true },
    });
    expect(canceled.canceledAt).toEqual(bed.clock.now());
    expect((await cancel.execute(as('bia'), { taskId: task.id, version: 2 })).version).toBe(2);
    expect(
      await code(
        new UpdateTaskUseCase(bed).execute(as('bia'), { taskId: task.id, title: 'Y', version: 2 }),
      ),
    ).toBe('TASK_CANCELED');
    expect(
      await code(
        new AssignTaskUseCase(bed).execute(as('bia'), {
          taskId: task.id,
          assigneeUserId: 'bia',
          version: 2,
        }),
      ),
    ).toBe('TASK_CANCELED');
    expect(await code(move(bed, task.id, 'web-doing'))).toBe('TASK_CANCELED');
    const reopened = await reopen.execute(as('bia'), { taskId: task.id, version: 2 });
    expect(reopened).toMatchObject({ canceledAt: null, version: 3 });
    expect((await reopen.execute(as('bia'), { taskId: task.id, version: 3 })).version).toBe(3);
    expect(bed.events.events.map((event) => event.type)).toEqual([
      'tasks.canceled',
      'tasks.reopened',
    ]);
    expect(bed.tasks.projectLocks).toEqual([WEB, WEB, WEB, WEB]);
  });

  it('checks the version and the permission', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });

    expect(
      await code(new CancelTaskUseCase(bed).execute(as('mia'), { taskId: task.id, version: 5 })),
    ).toBe('VERSION_CONFLICT');
    expect(
      await code(new CancelTaskUseCase(bed).execute(as('vivi'), { taskId: task.id, version: 1 })),
    ).toBe('INSUFFICIENT_ROLE');
    expect(
      await code(new ReopenTaskUseCase(bed).execute(as('vivi'), { taskId: task.id, version: 1 })),
    ).toBe('INSUFFICIENT_ROLE');
  });

  it('D1: reopening a required subtask of a completed parent ⇒ PARENT_TASK_COMPLETED', async () => {
    const { bed } = createTasksWorld();
    const parent = await create(bed, { projectId: WEB, title: 'Pai' });
    const pending = await create(bed, {
      projectId: WEB,
      title: 'Pendente',
      parentTaskId: parent.id,
      isRequired: true,
    });
    const done = await create(bed, {
      projectId: WEB,
      title: 'Concluída',
      parentTaskId: parent.id,
      isRequired: true,
    });
    forceStatus(bed, done.id, 'web-done');
    forceCancel(bed, pending.id);
    forceCancel(bed, done.id);
    forceStatus(bed, parent.id, 'web-done');
    const reopen = new ReopenTaskUseCase(bed);

    expect(await code(reopen.execute(as('mia'), { taskId: pending.id, version: 1 }))).toBe(
      'PARENT_TASK_COMPLETED',
    );
    // Concluída e cancelada: reabrir não a deixa pendente.
    expect(await code(reopen.execute(as('mia'), { taskId: done.id, version: 1 }))).toBe('ok');
  });

  it('D1: a canceled parent in done cannot come back with a pending required subtask', async () => {
    const { bed } = createTasksWorld();
    const parent = await create(bed, { projectId: WEB, title: 'Pai' });
    const child = await create(bed, {
      projectId: WEB,
      title: 'Filha',
      parentTaskId: parent.id,
      isRequired: true,
    });
    forceStatus(bed, parent.id, 'web-done');
    forceCancel(bed, parent.id);

    expect(
      await idsOf(new ReopenTaskUseCase(bed).execute(as('mia'), { taskId: parent.id, version: 1 })),
    ).toEqual([child.id]);
  });
});

describe('DeleteTaskUseCase (RF-10, D5, CA-06)', () => {
  it('deletes with subtasks and dependencies; canceled tasks too', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' }, 'bia');
    await create(bed, { projectId: WEB, title: 'Filha', parentTaskId: task.id }, 'bia');
    const other = await create(bed, { projectId: WEB, title: 'Outra' });
    await new AddDependencyUseCase(bed).execute(as('mia'), {
      taskId: other.id,
      blockingTaskId: task.id,
    });
    forceCancel(bed, task.id);
    bed.events.events = [];

    await new DeleteTaskUseCase(bed).execute(as('bia'), { taskId: task.id, version: 1 });

    expect(bed.tasks.rows.map((row) => row.id)).toEqual([other.id]);
    expect(await bed.dependencies.countInProject('org-a', WEB)).toBe(0);
    expect(bed.events.events).toEqual([
      expect.objectContaining({ type: 'tasks.deleted', taskId: task.id }),
    ]);
  });

  it("D5: a member cannot delete someone else's task or one with someone else's subtask; a manager can", async () => {
    const { bed } = createTasksWorld();
    const mine = await create(bed, { projectId: WEB, title: 'Da Bia' }, 'bia');
    await create(bed, { projectId: WEB, title: 'Da Mia', parentTaskId: mine.id }, 'mia');
    const theirs = await create(bed, { projectId: WEB, title: 'Da Mia' }, 'mia');
    const remove = new DeleteTaskUseCase(bed);

    expect(await code(remove.execute(as('bia'), { taskId: mine.id, version: 1 }))).toBe(
      'INSUFFICIENT_ROLE',
    );
    expect(await code(remove.execute(as('bia'), { taskId: theirs.id, version: 1 }))).toBe(
      'INSUFFICIENT_ROLE',
    );
    expect(await code(remove.execute(as('vivi'), { taskId: theirs.id, version: 1 }))).toBe(
      'INSUFFICIENT_ROLE',
    );
    expect(await code(remove.execute(as('mia'), { taskId: mine.id, version: 1 }))).toBe('ok');
  });

  it('BR-008: a stale version is refused', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });

    expect(
      await code(new DeleteTaskUseCase(bed).execute(as('mia'), { taskId: task.id, version: 2 })),
    ).toBe('VERSION_CONFLICT');
    expect(bed.tasks.rows).toHaveLength(1);
  });
});

describe('dependencies (RF-08, BR-006, CA-04)', () => {
  it('adds idempotently and removes; absent ⇒ DEPENDENCY_NOT_FOUND', async () => {
    const { bed } = createTasksWorld();
    const blocked = await create(bed, { projectId: WEB, title: 'A' });
    const blocker = await create(bed, { projectId: WEB, title: 'B' });
    bed.events.events = [];
    const add = new AddDependencyUseCase(bed);
    const remove = new RemoveDependencyUseCase(bed);

    const first = await add.execute(as('bia'), { taskId: blocked.id, blockingTaskId: blocker.id });
    const again = await add.execute(as('bia'), { taskId: blocked.id, blockingTaskId: blocker.id });
    await remove.execute(as('bia'), { taskId: blocked.id, blockingTaskId: blocker.id });

    expect(first.created).toBe(true);
    expect(first.task.blockedBy.map((item) => item.id)).toEqual([blocker.id]);
    expect(again.created).toBe(false);
    expect(
      await code(remove.execute(as('bia'), { taskId: blocked.id, blockingTaskId: blocker.id })),
    ).toBe('DEPENDENCY_NOT_FOUND');
    expect(bed.events.events.map((event) => event.type)).toEqual([
      'tasks.dependency_added',
      'tasks.dependency_removed',
    ]);
    expect(bed.tasks.projectLocks.length).toBeGreaterThanOrEqual(3);
  });

  it('refuses cycles, self, a blocker of another project and a canceled blocked task', async () => {
    const { bed } = createTasksWorld();
    const a = await create(bed, { projectId: WEB, title: 'A' });
    const b = await create(bed, { projectId: WEB, title: 'B' });
    const c = await create(bed, { projectId: WEB, title: 'C' });
    const elsewhere = await create(bed, { projectId: 'p-app', title: 'APP' }, 'bia');
    const add = new AddDependencyUseCase(bed);
    await add.execute(as('mia'), { taskId: a.id, blockingTaskId: b.id });
    await add.execute(as('mia'), { taskId: b.id, blockingTaskId: c.id });

    expect(await code(add.execute(as('mia'), { taskId: c.id, blockingTaskId: a.id }))).toBe(
      'DEPENDENCY_CYCLE',
    );
    expect(await code(add.execute(as('mia'), { taskId: a.id, blockingTaskId: a.id }))).toBe(
      'DEPENDENCY_CYCLE',
    );
    expect(await code(add.execute(as('mia'), { taskId: a.id, blockingTaskId: elsewhere.id }))).toBe(
      'TASK_NOT_FOUND',
    );
    forceCancel(bed, a.id);
    expect(await code(add.execute(as('mia'), { taskId: a.id, blockingTaskId: c.id }))).toBe(
      'TASK_CANCELED',
    );
    expect(
      await code(
        new RemoveDependencyUseCase(bed).execute(as('mia'), { taskId: a.id, blockingTaskId: b.id }),
      ),
    ).toBe('TASK_CANCELED');
  });

  it('D4: a required subtask cannot be blocked by its own parent, directly or not', async () => {
    const { bed } = createTasksWorld();
    const parent = await create(bed, { projectId: WEB, title: 'Pai' });
    const child = await create(bed, {
      projectId: WEB,
      title: 'Filha',
      parentTaskId: parent.id,
      isRequired: true,
    });
    const middle = await create(bed, { projectId: WEB, title: 'Meio' });
    const add = new AddDependencyUseCase(bed);

    expect(
      await code(add.execute(as('mia'), { taskId: child.id, blockingTaskId: parent.id })),
    ).toBe('DEPENDENCY_CYCLE');
    await add.execute(as('mia'), { taskId: middle.id, blockingTaskId: parent.id });
    expect(
      await code(add.execute(as('mia'), { taskId: child.id, blockingTaskId: middle.id })),
    ).toBe('DEPENDENCY_CYCLE');
  });

  it('RNF-05: at most 50 blockers per task and 5 000 dependencies per project (duplicates stay idempotent)', async () => {
    const { bed } = createTasksWorld();
    const blocked = await create(bed, { projectId: WEB, title: 'Alvo' });
    const add = new AddDependencyUseCase(bed);
    let last = blocked.id;
    for (let index = 0; index < 50; index += 1) {
      last = (await create(bed, { projectId: WEB, title: `B${index}` })).id;
      await add.execute(as('mia'), { taskId: blocked.id, blockingTaskId: last });
    }
    const extra = await create(bed, { projectId: WEB, title: 'Extra' });

    expect(
      await code(add.execute(as('mia'), { taskId: blocked.id, blockingTaskId: extra.id })),
    ).toBe('DEPENDENCY_LIMIT_REACHED');
    expect(
      (await add.execute(as('mia'), { taskId: blocked.id, blockingTaskId: last })).created,
    ).toBe(false);
    bed.dependencies.countInProject = async () => 5_000;
    expect(await code(add.execute(as('mia'), { taskId: extra.id, blockingTaskId: last }))).toBe(
      'DEPENDENCY_LIMIT_REACHED',
    );
    bed.dependencies.countInProject = async () => 4_999;
    expect(await code(add.execute(as('mia'), { taskId: extra.id, blockingTaskId: last }))).toBe(
      'ok',
    );
  });
});

describe('archived project (RF-12, CA-08)', () => {
  it('every write answers PROJECT_ARCHIVED, after 403, and reads go on', async () => {
    const { bed, web } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });
    const other = await create(bed, { projectId: WEB, title: 'Y' });
    await new AddDependencyUseCase(bed).execute(as('mia'), {
      taskId: task.id,
      blockingTaskId: other.id,
    });
    web.archived = true;
    const ref = { taskId: task.id, version: 1 };
    const writes: ReadonlyArray<(actor: string) => Promise<unknown>> = [
      (actor) => new CreateTaskUseCase(bed).execute(as(actor), { projectId: WEB, title: 'Z' }),
      (actor) => new UpdateTaskUseCase(bed).execute(as(actor), { ...ref, title: 'Z' }),
      (actor) => new AssignTaskUseCase(bed).execute(as(actor), { ...ref, assigneeUserId: 'mia' }),
      (actor) =>
        new TransitionTaskUseCase(bed).execute(as(actor), { ...ref, statusId: 'web-doing' }),
      (actor) => new CancelTaskUseCase(bed).execute(as(actor), ref),
      (actor) => new ReopenTaskUseCase(bed).execute(as(actor), ref),
      (actor) => new DeleteTaskUseCase(bed).execute(as(actor), ref),
      (actor) =>
        new AddDependencyUseCase(bed).execute(as(actor), {
          taskId: other.id,
          blockingTaskId: task.id,
        }),
      (actor) =>
        new RemoveDependencyUseCase(bed).execute(as(actor), {
          taskId: task.id,
          blockingTaskId: other.id,
        }),
    ];
    // Em sequência: o runner falso não simula transações simultâneas.
    const outcomes = async (actor: string) => {
      const codes: Array<string | undefined> = [];
      for (const write of writes) codes.push(await code(write(actor)));
      return codes;
    };

    expect(await outcomes('mia')).toEqual(Array(9).fill('PROJECT_ARCHIVED'));
    expect(await outcomes('vivi')).toEqual(Array(9).fill('INSUFFICIENT_ROLE'));
    expect(await new GetTaskUseCase(bed).execute(as('vivi'), { taskId: task.id })).toMatchObject({
      key: 'WEB-1',
    });
    expect(bed.tasks.rows.map((row) => row.version)).toEqual([1, 1]);
  });
});
