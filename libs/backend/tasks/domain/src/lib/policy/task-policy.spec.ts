import type { ProjectRole } from '@taskflow/backend/shared/kernel';
import type { WorkflowView } from '../workflow/workflow';
import { taskActions } from './task-policy';

const workflow: WorkflowView = {
  statuses: [],
  transitions: [
    { fromStatusId: 'todo', toStatusId: 'doing' },
    { fromStatusId: 'doing', toStatusId: 'done' },
  ],
};
const actions = (
  effectiveRole: ProjectRole | null,
  overrides: Partial<{ archived: boolean; isCanceled: boolean; ownsTaskTree: boolean }> = {},
) =>
  taskActions({
    effectiveRole,
    archived: overrides.archived ?? false,
    task: { isCanceled: overrides.isCanceled ?? false, statusId: 'todo' },
    ownsTaskTree: overrides.ownsTaskTree ?? false,
    workflow,
  });

describe('taskActions', () => {
  it('managers and members work on tasks; viewers only read', () => {
    expect(actions('member')).toEqual({
      update: true,
      assign: true,
      cancel: true,
      reopen: false,
      delete: false,
      transitionTo: ['doing'],
    });
    expect(actions('manager').delete).toBe(true);
    expect(actions('viewer')).toEqual({
      update: false,
      assign: false,
      cancel: false,
      reopen: false,
      delete: false,
      transitionTo: [],
    });
  });

  it('D5: a member deletes only a task tree entirely created by them', () => {
    expect(actions('member', { ownsTaskTree: true }).delete).toBe(true);
    expect(actions('member', { ownsTaskTree: false }).delete).toBe(false);
  });

  it('BR-029: a canceled task can only be reopened or deleted', () => {
    expect(actions('manager', { isCanceled: true })).toEqual({
      update: false,
      assign: false,
      cancel: false,
      reopen: true,
      delete: true,
      transitionTo: [],
    });
  });

  it('BR-026: an archived project allows nothing', () => {
    expect(
      Object.values(actions('manager', { archived: true }))
        .flat()
        .filter(Boolean),
    ).toEqual([]);
  });
});
