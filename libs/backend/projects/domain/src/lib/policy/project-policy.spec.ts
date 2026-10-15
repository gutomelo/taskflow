import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';
import { participantActions, projectCapabilities } from './project-policy';

describe('projectCapabilities', () => {
  it('lists the allowed project permissions of the effective role (matrix of spec 006)', () => {
    expect(projectCapabilities('manager', { archived: false })).toEqual([
      'project:read',
      'project:update',
      'project:archive',
      'project-member:manage',
      'task:create',
      'task:update',
      'task:assign',
      'task:delete',
      'comment:create',
      'comment:delete',
      'sprint:manage',
      'board:configure',
    ]);
    // `own` (task:delete, comment:update/delete do member) não entra nas capacidades.
    expect(projectCapabilities('member', { archived: false })).toEqual([
      'project:read',
      'task:create',
      'task:update',
      'task:assign',
      'comment:create',
    ]);
    expect(projectCapabilities('viewer', { archived: false })).toEqual(['project:read']);
    expect(projectCapabilities(null, { archived: false })).toEqual([]);
  });

  it('BR-026: an archived project only keeps reading and restoring', () => {
    expect(projectCapabilities('manager', { archived: true })).toEqual([
      'project:read',
      'project:archive',
    ]);
    expect(projectCapabilities('member', { archived: true })).toEqual(['project:read']);
    expect(projectCapabilities(null, { archived: true })).toEqual([]);
  });
});

describe('participantActions', () => {
  const actions = (
    actorEffectiveRole: ProjectRole | null,
    targetOrganizationRole: OrganizationRole,
    overrides: Partial<{ targetRole: ProjectRole; isSelf: boolean; archived: boolean }> = {},
  ) =>
    participantActions({
      actorEffectiveRole,
      targetRole: overrides.targetRole ?? 'member',
      targetOrganizationRole,
      isSelf: overrides.isSelf ?? false,
      archived: overrides.archived ?? false,
    });

  it('a manager may change a member to the other roles and remove them', () => {
    expect(actions('manager', 'member')).toEqual({
      changeRoleTo: ['manager', 'viewer'],
      remove: true,
      leave: false,
    });
  });

  it('BR-027: roles offered for a viewer of the organization stay within the ceiling', () => {
    expect(actions('manager', 'viewer', { targetRole: 'viewer' }).changeRoleTo).toEqual([]);
    expect(actions('manager', 'admin').changeRoleTo).toEqual([]);
  });

  it('members and viewers of the project manage nobody; anyone may leave', () => {
    expect(actions('member', 'member')).toEqual({ changeRoleTo: [], remove: false, leave: false });
    expect(actions('viewer', 'member', { isSelf: true })).toEqual({
      changeRoleTo: [],
      remove: false,
      leave: true,
    });
  });

  it('BR-026: in an archived project roles do not change, but removing still works', () => {
    expect(actions('manager', 'member', { archived: true })).toEqual({
      changeRoleTo: [],
      remove: true,
      leave: false,
    });
  });

  it('a manager never "removes" themselves (leaving has its own action)', () => {
    expect(actions('manager', 'member', { isSelf: true, targetRole: 'manager' })).toMatchObject({
      remove: false,
      leave: true,
    });
  });
});
