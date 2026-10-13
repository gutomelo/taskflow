import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import {
  VersionConflictError,
  type OrganizationRole,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import {
  AlreadyAProjectMemberError,
  AlreadyManagesAllProjectsError,
  NotAnOrganizationMemberError,
  ProjectArchivedError,
  ProjectMember,
  ProjectRoleAboveCeilingError,
} from '@taskflow/backend/projects/domain';
import { createProjectsTestbed, type ProjectsTestbed } from '../../testing/projects-fakes';
import { MAX_MEMBERS_PER_PROJECT } from '../shared/project-limits';
import {
  InsufficientRoleError,
  ProjectMemberLimitReachedError,
  ProjectMemberNotFoundError,
  ProjectNotFoundError,
} from '../shared/projects-errors';
import { CreateProjectUseCase } from './create-project.use-case';
import {
  AddProjectMemberUseCase,
  ChangeProjectMemberRoleUseCase,
  ListMemberCandidatesUseCase,
  ListProjectMembersUseCase,
  RemoveProjectMemberUseCase,
} from './project-member.use-cases';
import { ArchiveProjectUseCase } from './update-project.use-cases';

const ORG = 'org-a';
const ROLES: Record<string, OrganizationRole> = {
  ana: 'owner',
  adm: 'admin',
  mia: 'member', // manager de P1 (criadora)
  bia: 'member',
  caio: 'member',
  davi: 'member', // só participa de P2
  vivi: 'viewer',
};

function as(userId: string): TenantRequestContext {
  const role = ROLES[userId];
  if (!role) throw new Error(`unknown user ${userId}`);
  return {
    requestId: 'req-1',
    actor: { userId, sessionId: `s-${userId}` },
    tenant: { organizationId: ORG, organizationRole: role },
  };
}

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

/** P1 (mia manager, bia member) e P2 (mia manager, davi member). */
async function world() {
  const bed = createProjectsTestbed();
  for (const [userId, role] of Object.entries(ROLES))
    bed.organizationAccess.setMember(ORG, userId, role);
  for (const [id, name] of [
    ['mia', 'Mia'],
    ['bia', 'Bia'],
    ['caio', 'Caio'],
    ['vivi', 'Vivi'],
  ]) {
    bed.users.add({ id: id ?? '', name: name ?? '', email: `${id}@exemplo.com` });
  }
  const create = new CreateProjectUseCase(bed);
  const p1 = await create.execute(as('mia'), { key: 'WEB', name: 'Website' });
  const p2 = await create.execute(as('mia'), { key: 'APP', name: 'Aplicativo' });
  await participate(bed, p1.id, 'bia', 'member');
  await participate(bed, p2.id, 'davi', 'member');
  bed.securityEvents.events = [];
  return { bed, p1: p1.id, p2: p2.id };
}

const add = (
  bed: ProjectsTestbed,
  actor: string,
  projectId: string,
  userId: string,
  role: ProjectRole,
) => new AddProjectMemberUseCase(bed).execute(as(actor), { projectId, userId, role });

describe('AddProjectMemberUseCase (RF-07, BR-027)', () => {
  it('CA-06: the manager adds a member of the organization, with the actions computed', async () => {
    const { bed, p1 } = await world();

    const view = await add(bed, 'mia', p1, 'caio', 'member');

    expect(view).toMatchObject({
      userId: 'caio',
      name: 'Caio',
      role: 'member',
      effectiveRole: 'member',
      version: 1,
      actions: { changeRoleTo: ['manager', 'viewer'], remove: true, leave: false },
    });
    expect(bed.securityEvents.events).toEqual([
      expect.objectContaining({
        type: 'projects.member_added',
        projectId: p1,
        targetUserId: 'caio',
        role: 'member',
      }),
    ]);
  });

  it('CA-06: a user outside the organization gets the same 404, unknown or from another organization', async () => {
    const { bed, p1 } = await world();
    bed.organizationAccess.setMember('org-b', 'zeca', 'member');

    await expect(add(bed, 'mia', p1, 'nobody', 'member')).rejects.toBeInstanceOf(
      NotAnOrganizationMemberError,
    );
    await expect(add(bed, 'mia', p1, 'zeca', 'member')).rejects.toBeInstanceOf(
      NotAnOrganizationMemberError,
    );
  });

  it('BR-027: a viewer of the organization only joins as viewer; owner and admin never join (D1)', async () => {
    const { bed, p1 } = await world();

    await expect(add(bed, 'mia', p1, 'vivi', 'member')).rejects.toBeInstanceOf(
      ProjectRoleAboveCeilingError,
    );
    await expect(add(bed, 'mia', p1, 'vivi', 'manager')).rejects.toBeInstanceOf(
      ProjectRoleAboveCeilingError,
    );
    await expect(add(bed, 'mia', p1, 'adm', 'viewer')).rejects.toBeInstanceOf(
      AlreadyManagesAllProjectsError,
    );
    await expect(add(bed, 'mia', p1, 'vivi', 'viewer')).resolves.toMatchObject({ role: 'viewer' });
  });

  it('BR-027: a duplicate is refused; the limit applies last', async () => {
    const { bed, p1 } = await world();

    await expect(add(bed, 'mia', p1, 'bia', 'viewer')).rejects.toBeInstanceOf(
      AlreadyAProjectMemberError,
    );
    vi.spyOn(bed.projectMembers, 'count').mockResolvedValue(MAX_MEMBERS_PER_PROJECT);
    await expect(add(bed, 'mia', p1, 'bia', 'viewer')).rejects.toBeInstanceOf(
      AlreadyAProjectMemberError,
    );
    await expect(add(bed, 'mia', p1, 'caio', 'member')).rejects.toBeInstanceOf(
      ProjectMemberLimitReachedError,
    );
  });

  it('CA-03: 403 comes before any state error (no oracle), and non participants get 404', async () => {
    const { bed, p1 } = await world();

    for (const target of ['nobody', 'bia', 'vivi']) {
      await expect(add(bed, 'bia', p1, target, 'manager')).rejects.toBeInstanceOf(
        InsufficientRoleError,
      );
      await expect(add(bed, 'caio', p1, target, 'manager')).rejects.toBeInstanceOf(
        ProjectNotFoundError,
      );
    }
  });

  it('BR-026: an archived project takes no new participants', async () => {
    const { bed, p1 } = await world();
    await new ArchiveProjectUseCase(bed).execute(as('mia'), { projectId: p1, version: 1 });

    await expect(add(bed, 'mia', p1, 'caio', 'member')).rejects.toBeInstanceOf(
      ProjectArchivedError,
    );
  });
});

describe('ChangeProjectMemberRole and RemoveProjectMember (RF-08, CA-07)', () => {
  const change = (
    bed: ProjectsTestbed,
    actor: string,
    projectId: string,
    userId: string,
    role: ProjectRole,
    version = 1,
  ) =>
    new ChangeProjectMemberRoleUseCase(bed).execute(as(actor), {
      projectId,
      userId,
      role,
      version,
    });
  const remove = (
    bed: ProjectsTestbed,
    actor: string,
    projectId: string,
    userId: string,
    version = 1,
  ) => new RemoveProjectMemberUseCase(bed).execute(as(actor), { projectId, userId, version });

  it('CA-07: the manager changes a role with the version and removes participants', async () => {
    const { bed, p1 } = await world();

    expect(await change(bed, 'mia', p1, 'bia', 'viewer')).toMatchObject({
      role: 'viewer',
      version: 2,
    });
    await expect(change(bed, 'mia', p1, 'bia', 'member', 1)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    await expect(remove(bed, 'mia', p1, 'bia', 1)).rejects.toBeInstanceOf(VersionConflictError);
    await remove(bed, 'mia', p1, 'bia', 2);

    expect(await bed.projectMembers.find(ORG, p1, 'bia')).toBeNull();
    expect(bed.securityEvents.events.map((event) => event.type)).toEqual([
      'projects.member_role_changed',
      'projects.member_removed',
    ]);
  });

  it('CA-07 (IDOR): a manager of P1 cannot reach someone who only participates in P2', async () => {
    const { bed, p1, p2 } = await world();

    await expect(change(bed, 'mia', p1, 'davi', 'viewer')).rejects.toBeInstanceOf(
      ProjectMemberNotFoundError,
    );
    await expect(remove(bed, 'mia', p1, 'davi')).rejects.toBeInstanceOf(ProjectMemberNotFoundError);
    expect((await bed.projectMembers.find(ORG, p2, 'davi'))?.toSnapshot()).toMatchObject({
      role: 'member',
      version: 1,
    });
  });

  it('BR-027: the ceiling applies when changing a role', async () => {
    const { bed, p1 } = await world();
    await add(bed, 'mia', p1, 'vivi', 'viewer');

    await expect(change(bed, 'mia', p1, 'vivi', 'member')).rejects.toBeInstanceOf(
      ProjectRoleAboveCeilingError,
    );
  });

  it('CA-07: a project member removes nobody else but may leave; the only manager may leave too', async () => {
    const { bed, p1 } = await world();

    await expect(remove(bed, 'bia', p1, 'mia')).rejects.toBeInstanceOf(InsufficientRoleError);
    await remove(bed, 'bia', p1, 'bia');
    await remove(bed, 'mia', p1, 'mia');

    expect(await bed.projectMembers.listUserIds(ORG, p1)).toEqual([]);
    expect(
      bed.securityEvents.events.map((event) => [event.type, 'self' in event && event.self]),
    ).toEqual([
      ['projects.member_removed', true],
      ['projects.member_removed', true],
    ]);
  });

  it('an owner who does not participate "leaving" gets 404 for the participant, not 403', async () => {
    const { bed, p1 } = await world();

    await expect(remove(bed, 'ana', p1, 'ana')).rejects.toBeInstanceOf(ProjectMemberNotFoundError);
  });

  it('BR-026: in an archived project roles do not change, but removing and leaving still work', async () => {
    const { bed, p1 } = await world();
    await new ArchiveProjectUseCase(bed).execute(as('mia'), { projectId: p1, version: 1 });

    await expect(change(bed, 'mia', p1, 'bia', 'viewer')).rejects.toBeInstanceOf(
      ProjectArchivedError,
    );
    await remove(bed, 'bia', p1, 'bia');
    await expect(remove(bed, 'mia', p1, 'mia')).resolves.toBeUndefined();
  });

  it('after demoting oneself, the returned actions use the new role', async () => {
    const { bed, p1 } = await world();

    const view = await change(bed, 'mia', p1, 'mia', 'member');

    expect(view.actions).toEqual({ changeRoleTo: [], remove: false, leave: true });
  });
});

describe('ListProjectMembers and ListMemberCandidates (RF-06, RF-07)', () => {
  it('lists participants with effective roles and the reader actions, in fixed lookups', async () => {
    const { bed, p1 } = await world();
    await participate(bed, p1, 'vivi', 'manager'); // gravado antes de um rebaixamento

    const asManager = await new ListProjectMembersUseCase(bed).execute(as('mia'), {
      projectId: p1,
    });
    const asMember = await new ListProjectMembersUseCase(bed).execute(as('bia'), { projectId: p1 });

    expect(
      asManager.items.map((item) => [
        item.userId,
        item.role,
        item.effectiveRole,
        item.actions.remove,
      ]),
    ).toEqual([
      ['mia', 'manager', 'manager', false],
      ['bia', 'member', 'member', true],
      ['vivi', 'manager', 'viewer', true],
    ]);
    expect(asManager.items.find((item) => item.userId === 'vivi')?.actions.changeRoleTo).toEqual([
      'viewer',
    ]);
    expect(
      asMember.items.every(
        (item) => item.actions.changeRoleTo.length === 0 && !item.actions.remove,
      ),
    ).toBe(true);
    expect(bed.users.queries).toEqual([
      ['mia', 'bia', 'vivi'],
      ['mia', 'bia', 'vivi'],
    ]);
    await expect(
      new ListProjectMembersUseCase(bed).execute(as('caio'), { projectId: p1 }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('lists candidates without participants, owners and admins, with the roles the ceiling allows', async () => {
    const { bed, p1 } = await world();
    const candidates = new ListMemberCandidatesUseCase(bed);

    const page = await candidates.execute(as('mia'), { projectId: p1 });

    expect(page.items.map((item) => [item.userId, item.allowedRoles])).toEqual([
      ['caio', ['manager', 'member', 'viewer']],
      ['davi', ['manager', 'member', 'viewer']],
      ['vivi', ['viewer']],
    ]);
    await expect(candidates.execute(as('bia'), { projectId: p1 })).rejects.toBeInstanceOf(
      InsufficientRoleError,
    );
    await new ArchiveProjectUseCase(bed).execute(as('mia'), { projectId: p1, version: 1 });
    await expect(candidates.execute(as('mia'), { projectId: p1 })).rejects.toBeInstanceOf(
      ProjectArchivedError,
    );
  });
});
