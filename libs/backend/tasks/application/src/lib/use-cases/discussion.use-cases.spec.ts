import {
  as,
  B_WEB,
  createTasksWorld,
  forceCancel,
  OTHER_ORG,
  ORG,
  WEB,
} from '../../testing/tasks-world';
import { CreateTaskUseCase } from './create-task.use-case';
import {
  LockTaskForDiscussionUseCase,
  ResolveTaskForDiscussionUseCase,
} from './discussion.use-cases';

async function world() {
  const { bed, web } = createTasksWorld();
  const task = await new CreateTaskUseCase(bed).execute(as('mia'), { projectId: WEB, title: 'T' });
  const foreign = await new CreateTaskUseCase(bed).execute(as('zoe', 'owner', OTHER_ORG), {
    projectId: B_WEB,
    title: 'Outra organização',
  });
  return { bed, web, task, foreign };
}

describe('LockTaskForDiscussion (spec 010)', () => {
  it('locks the project and the people, then the task FOR SHARE, returning roles without deciding', async () => {
    const { bed, task } = await world();

    const locked = await bed.transactions.run(() =>
      new LockTaskForDiscussionUseCase(bed).execute(ORG, task.id, [
        'bia',
        'vivi',
        'ana',
        'otto',
        'zoe',
      ]),
    );

    expect(locked).toEqual({
      taskId: task.id,
      projectId: WEB,
      archived: false,
      canceled: false,
      effectiveRoles: new Map([
        ['bia', 'member'],
        ['vivi', 'viewer'],
        ['ana', 'manager'],
        ['otto', null],
        ['zoe', null],
      ]),
    });
    expect(bed.projectAccess.locks.at(-1)).toEqual({
      projectId: WEB,
      userIds: ['bia', 'vivi', 'ana', 'otto', 'zoe'],
    });
    expect(bed.tasks.sharedTaskLocks).toEqual([task.id]);
    expect(bed.tasks.taskLocks).toEqual([]);
  });

  it('reports archived and canceled as data', async () => {
    const { bed, web, task } = await world();
    web.archived = true;
    forceCancel(bed, task.id);

    const locked = await bed.transactions.run(() =>
      new LockTaskForDiscussionUseCase(bed).execute(ORG, task.id, ['bia']),
    );

    expect(locked).toMatchObject({ archived: true, canceled: true });
  });

  it('a task of another organization or missing is null, without locking anything', async () => {
    const { bed, foreign } = await world();
    const lock = (taskId: string) =>
      bed.transactions.run(() =>
        new LockTaskForDiscussionUseCase(bed).execute(ORG, taskId, ['bia']),
      );

    expect(await lock(foreign.id)).toBeNull();
    expect(await lock('missing')).toBeNull();
    expect(bed.tasks.sharedTaskLocks).toEqual([]);
  });

  it('only inside a transaction', async () => {
    const { bed, task } = await world();
    await expect(
      new LockTaskForDiscussionUseCase(bed).execute(ORG, task.id, ['bia']),
    ).rejects.toThrow();
  });
});

describe('ResolveTaskForDiscussion (spec 010)', () => {
  it('gives the reader role and the task state', async () => {
    const { bed, task } = await world();
    forceCancel(bed, task.id);

    expect(
      await new ResolveTaskForDiscussionUseCase(bed).execute(ORG, task.id, {
        userId: 'vivi',
        organizationRole: 'viewer',
      }),
    ).toEqual({
      taskId: task.id,
      projectId: WEB,
      archived: false,
      canceled: true,
      effectiveRole: 'viewer',
    });
  });

  it('no access, another organization or missing are the same null', async () => {
    const { bed, task, foreign } = await world();
    const resolve = (taskId: string, userId: string) =>
      new ResolveTaskForDiscussionUseCase(bed).execute(ORG, taskId, {
        userId,
        organizationRole: 'member',
      });

    expect(await resolve(task.id, 'otto')).toBeNull();
    expect(await resolve(foreign.id, 'bia')).toBeNull();
    expect(await resolve('missing', 'bia')).toBeNull();
  });
});
