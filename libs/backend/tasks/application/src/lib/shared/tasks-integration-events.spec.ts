import { as, createTasksWorld, WEB } from '../../testing/tasks-world';
import { CreateTaskUseCase } from '../use-cases/create-task.use-case';
import { AssignTaskUseCase } from '../use-cases/edit-task.use-cases';
import { TasksIntegrationEventType } from './tasks-integration-events';

// ADR 0017 / spec 008: a atribuição vira evento de integração na transação do fato.
describe('tasks integration events (spec 008, T4)', () => {
  it('creating with an assignee and changing the assignee record the fact, only with ids', async () => {
    const { bed } = createTasksWorld();
    const created = await new CreateTaskUseCase(bed).execute(as('mia'), {
      projectId: WEB,
      title: 'T',
      assigneeUserId: 'bia',
    });
    await new AssignTaskUseCase(bed).execute(as('mia'), {
      taskId: created.id,
      assigneeUserId: 'mia',
      version: created.version,
    });

    expect(bed.outbox.events.map((event) => [event.type, event.payload])).toEqual([
      [
        TasksIntegrationEventType.assigneeChanged,
        {
          organizationId: 'org-a',
          projectId: WEB,
          taskId: created.id,
          actorUserId: 'mia',
          assigneeUserId: 'bia',
        },
      ],
      // O produtor emite o fato; quem decide não notificar a si mesmo é `notifications` (D7).
      [
        TasksIntegrationEventType.assigneeChanged,
        {
          organizationId: 'org-a',
          projectId: WEB,
          taskId: created.id,
          actorUserId: 'mia',
          assigneeUserId: 'mia',
        },
      ],
    ]);
    expect(new Set(bed.outbox.events.map((event) => event.id)).size).toBe(2);
  });

  it('no assignee, unassigning or a refused write record nothing', async () => {
    const { bed } = createTasksWorld();
    const created = await new CreateTaskUseCase(bed).execute(as('mia'), {
      projectId: WEB,
      title: 'T',
    });
    const assign = new AssignTaskUseCase(bed);
    await expect(
      assign.execute(as('mia'), { taskId: created.id, assigneeUserId: 'bia', version: 99 }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(
      assign.execute(as('mia'), { taskId: created.id, assigneeUserId: 'otto', version: 1 }),
    ).rejects.toMatchObject({ code: 'ASSIGNEE_NOT_PROJECT_MEMBER' });
    const assigned = await assign.execute(as('mia'), {
      taskId: created.id,
      assigneeUserId: 'bia',
      version: 1,
    });
    bed.outbox.events.length = 0;

    await assign.execute(as('mia'), {
      taskId: created.id,
      assigneeUserId: null,
      version: assigned.version,
    });

    expect(bed.outbox.events).toEqual([]);
  });

  it('BR-010: the event shares the transaction — if the outbox fails, the assignment is undone', async () => {
    const { bed } = createTasksWorld();
    const created = await new CreateTaskUseCase(bed).execute(as('mia'), {
      projectId: WEB,
      title: 'T',
    });
    bed.outbox.append = () => Promise.reject(new Error('outbox down'));

    await expect(
      new AssignTaskUseCase(bed).execute(as('mia'), {
        taskId: created.id,
        assigneeUserId: 'bia',
        version: 1,
      }),
    ).rejects.toThrow('outbox down');

    expect(bed.tasks.rows.find((row) => row.id === created.id)?.assigneeUserId).toBeNull();
  });
});
