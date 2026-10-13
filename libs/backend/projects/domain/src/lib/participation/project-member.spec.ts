import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';
import { AlreadyManagesAllProjectsError, ProjectRoleAboveCeilingError } from '../errors';
import { assignableProjectRoles, ProjectMember } from './project-member';

const NOW = new Date('2026-10-13T10:00:00.000Z');

function participation(role: ProjectRole, organizationRole: OrganizationRole) {
  return ProjectMember.create({
    id: 'pm-1',
    organizationId: 'org-1',
    projectId: 'p-1',
    userId: 'u-1',
    role,
    organizationRole,
    now: NOW,
  });
}

describe('ProjectMember (BR-027)', () => {
  // Esperado transcrito de BR-023/BR-027 e da decisão D1 (owner/admin não são gravados).
  it.each([
    ['member', ['manager', 'member', 'viewer']],
    ['viewer', ['viewer']],
    ['owner', []],
    ['admin', []],
  ] as const)('BR-027: a %s of the organization can be given %j', (organizationRole, roles) => {
    expect(assignableProjectRoles(organizationRole)).toEqual(roles);
  });

  it('BR-027: a viewer of the organization is capped at viewer, on creation and on change', () => {
    expect(() => participation('member', 'viewer')).toThrow(ProjectRoleAboveCeilingError);
    expect(() => participation('manager', 'viewer')).toThrow(ProjectRoleAboveCeilingError);

    const viewer = participation('viewer', 'viewer');
    expect(() => viewer.changeRole('manager', 'viewer', NOW)).toThrow(ProjectRoleAboveCeilingError);
    expect(viewer.role).toBe('viewer');
  });

  it.each<OrganizationRole>(['owner', 'admin'])(
    'BR-027 / D1: an organization %s is never recorded as a participant',
    (organizationRole) => {
      expect(() => participation('manager', organizationRole)).toThrow(
        AlreadyManagesAllProjectsError,
      );
      // Participação antiga de quem foi promovido: não se altera, só se remove.
      const old = participation('member', 'member');
      expect(() => old.changeRole('manager', organizationRole, NOW)).toThrow(
        AlreadyManagesAllProjectsError,
      );
    },
  );

  it('a member of the organization can hold and change to any project role', () => {
    const member = participation('viewer', 'member');
    member.changeRole('manager', 'member', NOW);

    expect(member.role).toBe('manager');
    expect(member.toSnapshot()).toMatchObject({ version: 1, userId: 'u-1', projectId: 'p-1' });
  });
});
