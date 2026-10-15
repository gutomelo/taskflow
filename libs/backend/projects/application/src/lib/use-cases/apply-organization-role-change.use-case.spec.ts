import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';
import { ProjectMember } from '@taskflow/backend/projects/domain';
import { createProjectsTestbed, type ProjectsTestbed } from '../../testing/projects-fakes';
import { ApplyOrganizationRoleChangeUseCase } from './apply-organization-role-change.use-case';

async function participate(
  bed: ProjectsTestbed,
  organizationId: string,
  projectId: string,
  userId: string,
  role: ProjectRole,
) {
  bed.projectMembers.organizationMembers.add(`${organizationId}|${userId}`);
  await bed.projectMembers.add(
    ProjectMember.create({
      id: bed.idGenerator.generate(),
      organizationId,
      projectId,
      userId,
      role,
      organizationRole: 'member',
      now: bed.clock.now(),
    }),
  );
}

const change = (toRole: OrganizationRole, fromRole: OrganizationRole = 'member') => ({
  organizationId: 'org-a',
  userId: 'eva',
  fromRole,
  toRole,
});

describe('ApplyOrganizationRoleChangeUseCase (BR-027)', () => {
  async function seeded() {
    const bed = createProjectsTestbed();
    await participate(bed, 'org-a', 'p1', 'eva', 'manager');
    await participate(bed, 'org-a', 'p2', 'eva', 'member');
    await participate(bed, 'org-a', 'p3', 'eva', 'viewer');
    await participate(bed, 'org-b', 'p9', 'eva', 'manager');
    await participate(bed, 'org-a', 'p1', 'bia', 'manager');
    return bed;
  }

  it('BR-027: demoting to viewer caps every participation in that organization, bumping versions', async () => {
    const bed = await seeded();

    const result = await bed.transactions.run(() =>
      new ApplyOrganizationRoleChangeUseCase(bed).execute(change('viewer')),
    );

    expect(result).toEqual({ affectedProjectParticipations: 2 });
    const roles = Object.fromEntries(
      bed.projectMembers.rows.map((row) => [
        `${row.organizationId}/${row.projectId}/${row.userId}`,
        [row.role, row.version],
      ]),
    );
    expect(roles).toEqual({
      'org-a/p1/eva': ['viewer', 2],
      'org-a/p2/eva': ['viewer', 2],
      'org-a/p3/eva': ['viewer', 1],
      'org-b/p9/eva': ['manager', 1],
      'org-a/p1/bia': ['manager', 1],
    });
  });

  it.each<OrganizationRole>(['member', 'admin', 'owner'])(
    'BR-027: changing to %s touches nothing (promoting back never restores)',
    async (toRole) => {
      const bed = await seeded();
      const before = structuredClone(bed.projectMembers.rows);

      const result = await bed.transactions.run(() =>
        new ApplyOrganizationRoleChangeUseCase(bed).execute(change(toRole, 'viewer')),
      );

      expect(result).toEqual({ affectedProjectParticipations: 0 });
      expect(bed.projectMembers.rows).toEqual(before);
    },
  );

  it('runs only inside the transaction of the caller', async () => {
    const bed = await seeded();

    await expect(
      new ApplyOrganizationRoleChangeUseCase(bed).execute(change('viewer')),
    ).rejects.toThrow(/inside a transaction/);
  });
});
