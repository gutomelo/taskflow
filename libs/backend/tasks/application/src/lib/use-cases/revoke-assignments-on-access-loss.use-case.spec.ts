import { Task, TaskTitle } from '@taskflow/backend/tasks/domain';
import { createTasksTestbed, type TasksTestbed } from '../../testing/tasks-fakes';
import { RevokeAssignmentsOnAccessLossUseCase } from './revoke-assignments-on-access-loss.use-case';

async function assigned(
  bed: TasksTestbed,
  organizationId: string,
  projectId: string,
  userId: string,
) {
  const task = Task.create({
    id: bed.idGenerator.generate(),
    organizationId,
    projectId,
    number: await bed.transactions.run(() => bed.tasks.nextNumber(organizationId, projectId)),
    title: TaskTitle.create('Tarefa'),
    description: null,
    status: { id: 's', name: 'A fazer', category: 'todo', position: 0 },
    priority: 'none',
    assigneeUserId: userId,
    dueDate: null,
    parentTaskId: null,
    isRequired: false,
    createdByUserId: 'u-0',
    now: bed.clock.now(),
  });
  await bed.tasks.add(task);
  return task.id;
}

describe('RevokeAssignmentsOnAccessLossUseCase (BR-003)', () => {
  async function seeded() {
    const bed = createTasksTestbed();
    const ids = {
      p1: await assigned(bed, 'org-a', 'p1', 'eva'),
      p2: await assigned(bed, 'org-a', 'p2', 'eva'),
      otherOrg: await assigned(bed, 'org-b', 'p9', 'eva'),
      otherUser: await assigned(bed, 'org-a', 'p1', 'bia'),
    };
    return { bed, ids };
  }
  const assignee = async (bed: TasksTestbed, organizationId: string, id: string) =>
    (await bed.tasks.findById(organizationId, id))?.assigneeUserId ?? null;

  it('BR-003: one project — only that project, only that person, bumping the version', async () => {
    const { bed, ids } = await seeded();

    const count = await bed.transactions.run(() =>
      new RevokeAssignmentsOnAccessLossUseCase(bed).execute({
        organizationId: 'org-a',
        userId: 'eva',
        scope: { projectId: 'p1' },
        stillContributorIn: [],
      }),
    );

    expect(count).toBe(1);
    expect(await assignee(bed, 'org-a', ids.p1)).toBeNull();
    expect((await bed.tasks.findById('org-a', ids.p1))?.version).toBe(2);
    expect(await assignee(bed, 'org-a', ids.p2)).toBe('eva');
    expect(await assignee(bed, 'org-a', ids.otherUser)).toBe('bia');
  });

  it('BR-003: whole organization except where the person still contributes; never another organization', async () => {
    const { bed, ids } = await seeded();

    await bed.transactions.run(() =>
      new RevokeAssignmentsOnAccessLossUseCase(bed).execute({
        organizationId: 'org-a',
        userId: 'eva',
        scope: 'organization',
        stillContributorIn: ['p2'],
      }),
    );

    expect(await assignee(bed, 'org-a', ids.p1)).toBeNull();
    expect(await assignee(bed, 'org-a', ids.p2)).toBe('eva');
    expect(await assignee(bed, 'org-b', ids.otherOrg)).toBe('eva');
  });

  it('keeps assignments when the person still contributes in that project', async () => {
    const { bed, ids } = await seeded();

    await bed.transactions.run(() =>
      new RevokeAssignmentsOnAccessLossUseCase(bed).execute({
        organizationId: 'org-a',
        userId: 'eva',
        scope: { projectId: 'p1' },
        stillContributorIn: ['p1'],
      }),
    );

    expect(await assignee(bed, 'org-a', ids.p1)).toBe('eva');
  });

  it('runs only inside the transaction of the caller', async () => {
    const { bed } = await seeded();

    await expect(
      new RevokeAssignmentsOnAccessLossUseCase(bed).execute({
        organizationId: 'org-a',
        userId: 'eva',
        scope: 'organization',
        stillContributorIn: [],
      }),
    ).rejects.toThrow(/inside a transaction/);
  });
});
