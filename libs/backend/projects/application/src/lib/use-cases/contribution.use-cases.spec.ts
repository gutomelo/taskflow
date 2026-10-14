import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';
import { ProjectMember } from '@taskflow/backend/projects/domain';
import { createProjectsTestbed, type ProjectsTestbed } from '../../testing/projects-fakes';
import { ApplyOrganizationRoleChangeUseCase } from './apply-organization-role-change.use-case';
import {
  ListAssignableUsersUseCase,
  LockProjectForContributionUseCase,
  ResolveProjectForReadUseCase,
} from './contribution.use-cases';
import { CreateProjectUseCase } from './create-project.use-case';
import {
  ChangeProjectMemberRoleUseCase,
  RemoveProjectMemberUseCase,
} from './project-member.use-cases';

const ORG = 'org-a';
const ROLES: Record<string, OrganizationRole> = {
  ana: 'owner',
  adm: 'admin',
  mia: 'member',
  bia: 'member',
  vivi: 'viewer',
};
const as = (userId: string) => ({
  requestId: 'req-1',
  actor: { userId, sessionId: `s-${userId}` },
  tenant: { organizationId: ORG, organizationRole: ROLES[userId] ?? 'member' },
});

async function participate(
  bed: ProjectsTestbed,
  projectId: string,
  userId: string,
  role: ProjectRole,
) {
  await bed.projectMembers.add(
    ProjectMember.create({
      id: bed.idGenerator.generate(),
      organizationId: ORG,
      projectId,
      userId,
      role,
      organizationRole: 'member',
      now: bed.clock.now(),
    }),
  );
}

/** P1 (WEB) e P2 (APP), criados por mia (manager); bia member em P1; vivi viewer em P1. */
async function world() {
  const bed = createProjectsTestbed();
  for (const [userId, role] of Object.entries(ROLES))
    bed.organizationAccess.setMember(ORG, userId, role);
  for (const id of Object.keys(ROLES))
    bed.users.add({ id, name: id.toUpperCase(), email: `${id}@exemplo.com` });
  const create = new CreateProjectUseCase(bed);
  const p1 = (await create.execute(as('mia'), { key: 'WEB', name: 'Website' })).id;
  const p2 = (await create.execute(as('mia'), { key: 'APP', name: 'Aplicativo' })).id;
  await participate(bed, p1, 'bia', 'member');
  await participate(bed, p1, 'vivi', 'viewer');
  return { bed, p1, p2 };
}

describe('ProjectContributorChanges triggers (spec 004, BR-003)', () => {
  it('removing a member of the organization from the project reports the loss in that project', async () => {
    const { bed, p1 } = await world();

    await new RemoveProjectMemberUseCase(bed).execute(as('mia'), {
      projectId: p1,
      userId: 'bia',
      version: 1,
    });

    expect(bed.contributorChanges.changes).toEqual([
      { organizationId: ORG, userId: 'bia', scope: { projectId: p1 }, stillContributorIn: [] },
    ]);
  });

  it('an admin leaving an old participation still contributes (decision 7): nothing is reported', async () => {
    const { bed, p1 } = await world();
    await participate(bed, p1, 'adm', 'member'); // participação antiga, de antes da promoção

    await new RemoveProjectMemberUseCase(bed).execute(as('adm'), {
      projectId: p1,
      userId: 'adm',
      version: 1,
    });

    expect(bed.contributorChanges.changes).toEqual([]);
  });

  it('changing a participation to viewer reports the loss; to member does not', async () => {
    const { bed, p1 } = await world();
    const change = new ChangeProjectMemberRoleUseCase(bed);

    await change.execute(as('mia'), { projectId: p1, userId: 'bia', role: 'manager', version: 1 });
    expect(bed.contributorChanges.changes).toEqual([]);
    await change.execute(as('mia'), { projectId: p1, userId: 'bia', role: 'viewer', version: 2 });

    expect(bed.contributorChanges.changes).toEqual([
      { organizationId: ORG, userId: 'bia', scope: { projectId: p1 }, stillContributorIn: [] },
    ]);
  });

  it('BR-003: an admin with an old viewer participation demoted to member loses that project only', async () => {
    const { bed, p1, p2 } = await world();
    await participate(bed, p1, 'adm', 'viewer');
    await participate(bed, p2, 'adm', 'member');

    await bed.transactions.run(() =>
      new ApplyOrganizationRoleChangeUseCase(bed).execute({
        organizationId: ORG,
        userId: 'adm',
        fromRole: 'admin',
        toRole: 'member',
      }),
    );

    expect(bed.contributorChanges.changes).toEqual([
      { organizationId: ORG, userId: 'adm', scope: 'organization', stillContributorIn: [p2] },
    ]);
  });

  it('demoted to viewer: participations capped and contributes nowhere; promotions report nothing', async () => {
    const { bed } = await world();
    const apply = (toRole: OrganizationRole) =>
      bed.transactions.run(() =>
        new ApplyOrganizationRoleChangeUseCase(bed).execute({
          organizationId: ORG,
          userId: 'bia',
          fromRole: 'member',
          toRole,
        }),
      );

    await apply('admin');
    expect(bed.contributorChanges.changes).toEqual([]);
    await apply('viewer');

    expect(bed.contributorChanges.changes).toEqual([
      { organizationId: ORG, userId: 'bia', scope: 'organization', stillContributorIn: [] },
    ]);
  });
});

describe('contribution use cases for tasks (spec 004, port ProjectAccess)', () => {
  it('locks the project and the memberships for share, computing effective roles', async () => {
    const { bed, p1 } = await world();

    const contribution = await bed.transactions.run(() =>
      new LockProjectForContributionUseCase(bed).execute(ORG, { key: 'WEB' }, [
        'ana',
        'bia',
        'vivi',
        'mia',
        'adm',
        'stranger',
      ]),
    );

    expect(bed.projects.shareLocks).toEqual([p1]);
    expect(bed.organizationAccess.memberShareLocks.at(-1)).toEqual([
      'ana',
      'bia',
      'vivi',
      'mia',
      'adm',
      'stranger',
    ]);
    expect(contribution).toMatchObject({ projectId: p1, key: 'WEB', archived: false });
    expect(Object.fromEntries(contribution?.effectiveRoles ?? [])).toEqual({
      ana: 'manager',
      adm: 'manager',
      mia: 'manager',
      bia: 'member',
      vivi: 'viewer',
      stranger: null,
    });
    expect([...(contribution?.organizationMembers ?? [])].sort()).toEqual([
      'adm',
      'ana',
      'bia',
      'mia',
      'vivi',
    ]);
    expect(contribution?.workflow.statuses.map((status) => status.category)).toEqual([
      'todo',
      'in_progress',
      'done',
    ]);
  });

  it('answers null for a project of another organization or missing, and fails outside a transaction', async () => {
    const { bed, p1 } = await world();

    expect(
      await bed.transactions.run(() =>
        new LockProjectForContributionUseCase(bed).execute('org-b', { projectId: p1 }, ['ana']),
      ),
    ).toBeNull();
    await expect(
      new LockProjectForContributionUseCase(bed).execute(ORG, { projectId: p1 }, ['ana']),
    ).rejects.toThrow(/inside a transaction/);
  });

  it('resolves a readable project by id or key, null without access', async () => {
    const { bed, p1, p2 } = await world();
    const resolve = new ResolveProjectForReadUseCase(bed);

    expect(
      await resolve.execute(ORG, { key: 'WEB' }, { userId: 'bia', organizationRole: 'member' }),
    ).toMatchObject({
      projectId: p1,
      effectiveRole: 'member',
    });
    expect(
      await resolve.execute(ORG, { projectId: p2 }, { userId: 'bia', organizationRole: 'member' }),
    ).toBeNull();
    expect(
      await resolve.execute(ORG, { projectId: p2 }, { userId: 'ana', organizationRole: 'owner' }),
    ).toMatchObject({
      effectiveRole: 'manager',
    });
  });

  it('lists assignable people: contributing participants, then owners and admins', async () => {
    const { bed, p1 } = await world();
    await participate(bed, p1, 'adm', 'member'); // participação antiga: aparece uma vez só, como manager
    const list = new ListAssignableUsersUseCase(bed);

    const participants = await list.execute(ORG, p1, { limit: 10, cursor: null });
    const managers = await list.execute(ORG, p1, { limit: 10, cursor: participants.nextCursor });

    expect(participants.items.map((item) => [item.userId, item.effectiveRole])).toEqual([
      ['mia', 'manager'],
      ['bia', 'member'],
    ]);
    expect(participants.nextCursor).toBe('o:');
    expect(managers.items.map((item) => [item.userId, item.name, item.effectiveRole])).toEqual([
      ['ana', 'ANA', 'manager'],
      ['adm', 'ADM', 'manager'],
    ]);
    expect(managers.nextCursor).toBeNull();
  });
});
