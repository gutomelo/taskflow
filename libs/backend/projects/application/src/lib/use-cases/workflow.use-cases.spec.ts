import { RateLimitedError } from '@taskflow/backend/shared/application';
import type { OrganizationRole } from '@taskflow/backend/shared/kernel';
import { ProjectMember } from '@taskflow/backend/projects/domain';
import { createProjectsTestbed, type ProjectsTestbed } from '../../testing/projects-fakes';
import { ArchiveProjectUseCase } from './update-project.use-cases';
import { CreateProjectUseCase } from './create-project.use-case';
import {
  CreateStatusUseCase,
  GetWorkflowUseCase,
  RemoveStatusUseCase,
  ReorderStatusesUseCase,
  ReplaceTransitionsUseCase,
  UpdateStatusUseCase,
  WORKFLOW_WRITE_POLICY,
} from './workflow.use-cases';

const ORG = 'org-a';
const ROLES: Record<string, OrganizationRole> = {
  ana: 'owner',
  mia: 'member',
  bia: 'member',
  otto: 'member',
};
const as = (userId: string) => ({
  requestId: 'req-1',
  actor: { userId, sessionId: `s-${userId}` },
  tenant: { organizationId: ORG, organizationRole: ROLES[userId] ?? 'member' },
});
const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: { code?: string; name?: string }) => error.code ?? error.name,
  );

/** WEB criado por mia (manager); bia participa como member; otto não participa. */
async function world() {
  const bed = createProjectsTestbed();
  for (const [userId, role] of Object.entries(ROLES))
    bed.organizationAccess.setMember(ORG, userId, role);
  const project = await new CreateProjectUseCase(bed).execute(as('mia'), {
    key: 'WEB',
    name: 'Website',
  });
  await bed.projectMembers.add(
    ProjectMember.create({
      id: bed.idGenerator.generate(),
      organizationId: ORG,
      projectId: project.id,
      userId: 'bia',
      role: 'member',
      organizationRole: 'member',
      now: bed.clock.now(),
    }),
  );
  const workflow = await new GetWorkflowUseCase(bed).execute(as('mia'), project.id);
  const [todo, doing, done] = workflow.statuses.map((status) => status.id);
  if (!todo || !doing || !done) throw new Error('default workflow');
  return { bed, projectId: project.id, todo, doing, done };
}

const names = async (bed: ProjectsTestbed, projectId: string) =>
  (await new GetWorkflowUseCase(bed).execute(as('mia'), projectId)).statuses.map(
    (status) => status.name,
  );

describe('workflow use cases (spec 005, BR-030)', () => {
  it('GetWorkflow brings the version and which statuses are in use; hidden ⇒ 404', async () => {
    const { bed, projectId, doing } = await world();
    bed.workflowStatusUsage.counts.set(doing, 2);

    const workflow = await new GetWorkflowUseCase(bed).execute(as('bia'), projectId);

    expect(workflow.version).toBe(1);
    expect(workflow.statuses.map((status) => [status.name, status.inUse])).toEqual([
      ['A fazer', false],
      ['Em andamento', true],
      ['Concluído', false],
    ]);
    expect(await code(new GetWorkflowUseCase(bed).execute(as('otto'), projectId))).toBe(
      'PROJECT_NOT_FOUND',
    );
  });

  it('creates a status under the project lock, with the lock timeout, bumping the version', async () => {
    const { bed, projectId } = await world();
    bed.projects.locks.length = 0;
    bed.transactions.options.length = 0;

    const workflow = await new CreateStatusUseCase(bed).execute(as('mia'), {
      projectId,
      name: 'Em revisão',
      category: 'in_progress',
      version: 1,
    });

    expect(workflow.version).toBe(2);
    expect(workflow.statuses.map((status) => status.name)).toEqual([
      'A fazer',
      'Em andamento',
      'Concluído',
      'Em revisão',
    ]);
    expect(bed.projects.locks).toEqual([projectId]);
    expect(bed.transactions.options).toEqual([{ lockTimeoutMs: 2_000 }]);
    expect(bed.securityEvents.events.at(-1)).toMatchObject({
      type: 'projects.workflow_changed',
      change: 'status_added',
      reassignedTasks: 0,
    });
  });

  it('decides 404 → 403 → archived → version → rules', async () => {
    const { bed, projectId } = await world();
    const create = new CreateStatusUseCase(bed);
    const command = { projectId, name: 'A FAZER', category: 'todo' as const, version: 9 };

    expect(await code(create.execute(as('otto'), command))).toBe('PROJECT_NOT_FOUND');
    expect(await code(create.execute(as('bia'), command))).toBe('INSUFFICIENT_ROLE');
    expect(await code(create.execute(as('mia'), command))).toBe('VERSION_CONFLICT');
    expect(await code(create.execute(as('mia'), { ...command, version: 1 }))).toBe(
      'STATUS_NAME_TAKEN',
    );
    await new ArchiveProjectUseCase(bed).execute(as('mia'), { projectId, version: 1 });
    expect(await code(create.execute(as('bia'), command))).toBe('INSUFFICIENT_ROLE');
    expect(await code(create.execute(as('mia'), command))).toBe('PROJECT_ARCHIVED');
  });

  it('renames and changes category only on a status without tasks', async () => {
    const { bed, projectId, doing, done } = await world();
    bed.workflowStatusUsage.counts.set(doing, 1);
    const update = new UpdateStatusUseCase(bed);

    expect(
      await code(
        update.execute(as('mia'), { projectId, statusId: doing, category: 'done', version: 1 }),
      ),
    ).toBe('STATUS_IN_USE');
    const renamed = await update.execute(as('mia'), {
      projectId,
      statusId: doing,
      name: 'Fazendo',
      version: 1,
    });
    expect(renamed.statuses.find((status) => status.id === doing)?.name).toBe('Fazendo');
    const recategorized = await update.execute(as('mia'), {
      projectId,
      statusId: done,
      category: 'in_progress',
      version: 2,
    });
    expect(recategorized.statuses.find((status) => status.id === done)?.category).toBe(
      'in_progress',
    );
  });

  it('removes a status reassigning its tasks to the target of the same category, in the same transaction', async () => {
    const { bed, projectId, doing } = await world();
    const review = await new CreateStatusUseCase(bed).execute(as('mia'), {
      projectId,
      name: 'Em revisão',
      category: 'in_progress',
      version: 1,
    });
    const reviewId = review.statuses.find((status) => status.name === 'Em revisão')?.id ?? '';
    bed.workflowStatusUsage.counts.set(reviewId, 3);
    const remove = new RemoveStatusUseCase(bed);

    expect(
      await code(remove.execute(as('mia'), { projectId, statusId: reviewId, version: 2 })),
    ).toBe('INVALID_STATUS_TARGET');
    expect(
      await code(
        remove.execute(as('mia'), {
          projectId,
          statusId: reviewId,
          moveTasksToStatusId: 'foreign',
          version: 2,
        }),
      ),
    ).toBe('STATUS_NOT_FOUND');
    expect(bed.workflowStatusUsage.reassignments).toEqual([]);
    const after = await remove.execute(as('mia'), {
      projectId,
      statusId: reviewId,
      moveTasksToStatusId: doing,
      version: 2,
    });

    expect(after.statuses.map((status) => status.name)).toEqual([
      'A fazer',
      'Em andamento',
      'Concluído',
    ]);
    expect(after.statuses.find((status) => status.id === doing)?.inUse).toBe(true);
    expect(bed.workflowStatusUsage.reassignments).toEqual([
      { projectId, fromStatusId: reviewId, toStatusId: doing },
    ]);
    expect(bed.securityEvents.events.at(-1)).toMatchObject({
      change: 'status_removed',
      reassignedTasks: 3,
    });
  });

  it('a failing save rolls back the reassignment (same transaction)', async () => {
    const { bed, projectId, doing } = await world();
    const review = await new CreateStatusUseCase(bed).execute(as('mia'), {
      projectId,
      name: 'Em revisão',
      category: 'in_progress',
      version: 1,
    });
    const reviewId = review.statuses.find((status) => status.name === 'Em revisão')?.id ?? '';
    bed.workflowStatusUsage.counts.set(reviewId, 2);
    const saveWorkflow = bed.projects.saveWorkflow.bind(bed.projects);
    bed.projects.saveWorkflow = async () => {
      throw new Error('boom');
    };

    expect(
      await code(
        new RemoveStatusUseCase(bed).execute(as('mia'), {
          projectId,
          statusId: reviewId,
          moveTasksToStatusId: doing,
          version: 2,
        }),
      ),
    ).toBe('Error');
    bed.projects.saveWorkflow = saveWorkflow;

    expect(bed.workflowStatusUsage.reassignments).toEqual([]);
    expect(bed.workflowStatusUsage.counts.get(reviewId)).toBe(2);
    expect(await names(bed, projectId)).toContain('Em revisão');
  });

  it('reorders columns and replaces transitions; foreign ids are 404 before the rules', async () => {
    const { bed, projectId, todo, doing, done } = await world();

    const reordered = await new ReorderStatusesUseCase(bed).execute(as('mia'), {
      projectId,
      statusIds: [done, todo, doing],
      version: 1,
    });
    expect(reordered.statuses.map((status) => status.name)).toEqual([
      'Concluído',
      'A fazer',
      'Em andamento',
    ]);
    const replaced = await new ReplaceTransitionsUseCase(bed).execute(as('mia'), {
      projectId,
      transitions: [{ fromStatusId: todo, toStatusId: done }],
      version: 2,
    });
    expect(replaced.transitions).toEqual([{ fromStatusId: todo, toStatusId: done }]);
    expect(
      await code(
        new ReorderStatusesUseCase(bed).execute(as('mia'), {
          projectId,
          statusIds: [todo, 'foreign'],
          version: 3,
        }),
      ),
    ).toBe('STATUS_NOT_FOUND');
    expect(
      await code(
        new ReplaceTransitionsUseCase(bed).execute(as('mia'), {
          projectId,
          transitions: [{ fromStatusId: todo, toStatusId: 'foreign' }],
          version: 3,
        }),
      ),
    ).toBe('STATUS_NOT_FOUND');
  });

  it('counts every attempt against projects.workflow.write.user.hour', async () => {
    const { bed, projectId } = await world();
    bed.rateLimiter.consumed.set(`${WORKFLOW_WRITE_POLICY.name}|mia`, WORKFLOW_WRITE_POLICY.points);

    await expect(
      new CreateStatusUseCase(bed).execute(as('mia'), {
        projectId,
        name: 'X',
        category: 'todo',
        version: 1,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });
});
