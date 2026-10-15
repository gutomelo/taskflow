import {
  as,
  createTasksWorld,
  forceCancel,
  forceStatus,
  APP,
  WEB,
} from '../../testing/tasks-world';
import type { TasksTestbed } from '../../testing/tasks-fakes';
import { CreateTaskUseCase } from './create-task.use-case';
import {
  GetTaskUseCase,
  ListAssignableUsersUseCase,
  ListTasksUseCase,
} from './task-queries.use-cases';

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

describe('ListTasksUseCase (RF-03, CA-07)', () => {
  async function thirty() {
    const world = createTasksWorld();
    const priorities = ['none', 'low', 'medium', 'high', 'urgent'] as const;
    const assignees = [null, 'bia', 'mia'] as const;
    for (let index = 1; index <= 30; index += 1) {
      await create(world.bed, {
        projectId: WEB,
        title: `T${index}`,
        priority: priorities[index % 5],
        assigneeUserId: assignees[index % 3],
      });
    }
    forceStatus(world.bed, world.bed.tasks.rows[0]?.id ?? '', 'web-doing');
    forceCancel(world.bed, world.bed.tasks.rows[1]?.id ?? '');
    return world;
  }

  it('pages 25 by number descending, with one name lookup per page', async () => {
    const { bed } = await thirty();
    const list = new ListTasksUseCase(bed);
    bed.users.calls.length = 0;

    const first = await list.execute(as('vivi'), { projectId: WEB });
    const second = await list.execute(as('vivi'), { projectId: WEB, cursor: first.nextCursor });

    expect(first.items.map((item) => item.number)).toEqual(
      Array.from({ length: 25 }, (_, index) => 30 - index),
    );
    expect(second.items.map((item) => item.number)).toEqual([5, 4, 3, 1]); // WEB-2 cancelada
    expect(second.nextCursor).toBeNull();
    expect(bed.users.calls).toHaveLength(2);
    expect(first.items[0]).toMatchObject({ key: 'WEB-30', assignee: null, priority: 'none' });
  });

  it('filters by status, person, me, nobody, priority and canceled', async () => {
    const { bed } = await thirty();
    const list = (query: Partial<Parameters<ListTasksUseCase['execute']>[1]>, actor = 'bia') =>
      new ListTasksUseCase(bed)
        .execute(as(actor), { projectId: WEB, limit: 100, ...query })
        .then((page) => page.items.map((item) => item.number));

    expect(await list({ statusId: 'web-doing' })).toEqual([1]);
    expect(await list({ assigneeUserId: 'mia' })).toEqual([29, 26, 23, 20, 17, 14, 11, 8, 5]);
    expect(await list({ assigned: 'me' })).toEqual(await list({ assigneeUserId: 'bia' }));
    expect(await list({ assigned: 'none' })).toEqual([30, 27, 24, 21, 18, 15, 12, 9, 6, 3]);
    expect(await list({ assigned: 'me', assigneeUserId: 'mia' })).toEqual([]);
    expect(await list({ assigned: 'none', assigneeUserId: 'mia' })).toEqual([]);
    expect(await list({ priority: 'urgent' })).toEqual([29, 24, 19, 14, 9, 4]);
    expect(await list({ canceled: true })).toHaveLength(30);
    expect(await list({ statusId: 'app-todo' })).toEqual([]);
  });

  it('lists subtasks of a parent only when asked', async () => {
    const { bed } = createTasksWorld();
    const parent = await create(bed, { projectId: WEB, title: 'Pai' });
    await create(bed, { projectId: WEB, title: 'Filha', parentTaskId: parent.id });

    const top = await new ListTasksUseCase(bed).execute(as('mia'), { projectId: WEB });
    const children = await new ListTasksUseCase(bed).execute(as('mia'), {
      projectId: WEB,
      parentTaskId: parent.id,
    });

    expect(top.items.map((item) => item.key)).toEqual(['WEB-1']);
    expect(children.items.map((item) => item.key)).toEqual(['WEB-2']);
  });

  it('answers PROJECT_NOT_FOUND without access, for another organization or missing', async () => {
    const { bed } = createTasksWorld();
    const list = new ListTasksUseCase(bed);

    expect(await code(list.execute(as('otto'), { projectId: WEB }))).toBe('PROJECT_NOT_FOUND');
    expect(await code(list.execute(as('bia'), { projectId: 'p-b-web' }))).toBe('PROJECT_NOT_FOUND');
    expect(await code(list.execute(as('ana'), { projectId: 'missing' }))).toBe('PROJECT_NOT_FOUND');
    expect(await code(list.execute(as('ana'), { projectId: APP }))).toBe('ok');
  });
});

describe('GetTaskUseCase (RF-04)', () => {
  it('by id and by key: subtasks, both dependency directions, transitions and actions', async () => {
    const { bed } = createTasksWorld();
    const task = await create(
      bed,
      { projectId: WEB, title: 'Principal', assigneeUserId: 'bia' },
      'bia',
    );
    const child = await create(
      bed,
      { projectId: WEB, title: 'Filha', parentTaskId: task.id, isRequired: true },
      'bia',
    );
    const blocker = await create(bed, { projectId: WEB, title: 'Bloqueadora' });
    const blocked = await create(bed, { projectId: WEB, title: 'Bloqueada' });
    await bed.dependencies.add('org-a', WEB, task.id, blocker.id);
    await bed.dependencies.add('org-a', WEB, blocked.id, task.id);
    const get = new GetTaskUseCase(bed);

    const byId = await get.execute(as('bia'), { taskId: task.id });
    const byKey = await get.execute(as('bia'), { key: 'WEB-1' });

    expect(byKey).toEqual(byId);
    expect(byId).toMatchObject({
      key: 'WEB-1',
      assignee: { userId: 'bia', name: 'BIA' },
      subtasks: [{ id: child.id, isRequired: true }],
      blockedBy: [{ id: blocker.id, key: 'WEB-3' }],
      blocking: [{ id: blocked.id, key: 'WEB-4' }],
      blockingTruncated: false,
      actions: {
        update: true,
        assign: true,
        cancel: true,
        reopen: false,
        delete: true,
        transitionTo: ['web-doing'],
      },
    });
  });

  it('D5: a member only gets delete when the task and all its subtasks are theirs', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'Da Bia' }, 'bia');
    await create(bed, { projectId: WEB, title: 'Da Mia', parentTaskId: task.id }, 'mia');

    expect(
      (await new GetTaskUseCase(bed).execute(as('bia'), { taskId: task.id })).actions.delete,
    ).toBe(false);
    expect(
      (await new GetTaskUseCase(bed).execute(as('mia'), { taskId: task.id })).actions.delete,
    ).toBe(true);
  });

  it('caps "blocking" at 50 and flags the truncation', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'Raiz' });
    for (let index = 0; index < 50; index += 1) {
      const other = await create(bed, { projectId: WEB, title: `B${index}` });
      await bed.dependencies.add('org-a', WEB, other.id, task.id);
    }
    const exactly = await new GetTaskUseCase(bed).execute(as('mia'), { taskId: task.id });
    const extra = await create(bed, { projectId: WEB, title: 'B50' });
    await bed.dependencies.add('org-a', WEB, extra.id, task.id);

    const view = await new GetTaskUseCase(bed).execute(as('mia'), { taskId: task.id });

    expect(exactly.blocking).toHaveLength(50);
    expect(exactly.blockingTruncated).toBe(false);

    expect(view.blocking).toHaveLength(50);
    expect(view.blockingTruncated).toBe(true);
  });

  it('a viewer reads without actions', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });

    expect(
      (await new GetTaskUseCase(bed).execute(as('vivi'), { taskId: task.id })).actions,
    ).toEqual({
      update: false,
      assign: false,
      cancel: false,
      reopen: false,
      delete: false,
      transitionTo: [],
    });
  });

  it('M3: missing, hidden, of another organization or malformed key ⇒ the same TASK_NOT_FOUND', async () => {
    const { bed } = createTasksWorld();
    const task = await create(bed, { projectId: WEB, title: 'X' });
    const get = new GetTaskUseCase(bed);

    expect(await code(get.execute(as('otto'), { taskId: task.id }))).toBe('TASK_NOT_FOUND');
    expect(await code(get.execute(as('otto'), { key: 'WEB-1' }))).toBe('TASK_NOT_FOUND');
    expect(await code(get.execute(as('mia'), { taskId: 'missing' }))).toBe('TASK_NOT_FOUND');
    expect(await code(get.execute(as('mia'), { key: 'WEB-9' }))).toBe('TASK_NOT_FOUND');
    expect(await code(get.execute(as('mia'), { key: 'web-1' }))).toBe('TASK_NOT_FOUND');
    expect(await code(get.execute(as('zoe', 'owner', 'org-b'), { taskId: task.id }))).toBe(
      'TASK_NOT_FOUND',
    );
    expect(await code(get.execute(as('zoe', 'owner', 'org-b'), { key: 'WEB-1' }))).toBe(
      'TASK_NOT_FOUND',
    );
  });
});

describe('ListAssignableUsersUseCase (RF-06)', () => {
  it('lists contributors for who may assign; 403 for a viewer; 404 without access', async () => {
    const { bed } = createTasksWorld();
    const list = new ListAssignableUsersUseCase(bed);

    const page = await list.execute(as('bia'), { projectId: WEB });

    expect(page.items.map((item) => item.userId).sort()).toEqual(['adm', 'ana', 'bia', 'mia']);
    expect(await code(list.execute(as('vivi'), { projectId: WEB }))).toBe('INSUFFICIENT_ROLE');
    expect(await code(list.execute(as('otto'), { projectId: WEB }))).toBe('PROJECT_NOT_FOUND');
  });
});
