import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import {
  VersionConflictError,
  type OrganizationRole,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import {
  InvalidProjectKeyError,
  ProjectArchivedError,
  ProjectKeyTakenError,
  ProjectMember,
} from '@taskflow/backend/projects/domain';
import { createProjectsTestbed, type ProjectsTestbed } from '../../testing/projects-fakes';
import { MAX_PROJECTS_PER_ORGANIZATION, PROJECT_CREATION_POLICY } from '../shared/project-limits';
import {
  InsufficientRoleError,
  OrganizationNotFoundError,
  ProjectLimitReachedError,
  ProjectNotFoundError,
} from '../shared/projects-errors';
import { CreateProjectUseCase } from './create-project.use-case';
import { GetProjectUseCase, GetWorkflowUseCase } from './get-project.use-case';
import { ListProjectsUseCase } from './list-projects.use-case';
import {
  ArchiveProjectUseCase,
  RestoreProjectUseCase,
  UpdateProjectUseCase,
} from './update-project.use-cases';

const ORG = 'org-a';

function as(userId: string, role: OrganizationRole, organizationId = ORG): TenantRequestContext {
  return {
    requestId: 'req-1',
    actor: { userId, sessionId: `s-${userId}` },
    tenant: { organizationId, organizationRole: role },
  };
}

/** Organização A com ana (owner), adm (admin), bia (member), caio (member), vivi (viewer). */
function world() {
  const bed = createProjectsTestbed();
  const roles: Array<[string, OrganizationRole]> = [
    ['ana', 'owner'],
    ['adm', 'admin'],
    ['bia', 'member'],
    ['caio', 'member'],
    ['vivi', 'viewer'],
  ];
  for (const [userId, role] of roles) bed.organizationAccess.setMember(ORG, userId, role);
  return bed;
}

function create(
  bed: ProjectsTestbed,
  userId: string,
  role: OrganizationRole,
  key = 'WEB',
  name = 'Website',
) {
  return new CreateProjectUseCase(bed).execute(as(userId, role), { key, name });
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

describe('CreateProjectUseCase (RF-01, BR-024, BR-025)', () => {
  it.each<OrganizationRole>(['owner', 'admin'])(
    'CA-01 / D1: an organization %s creates and manages the project without being recorded',
    async (role) => {
      const bed = world();
      const view = await create(bed, role === 'owner' ? 'ana' : 'adm', role);

      expect(view).toMatchObject({ key: 'WEB', name: 'Website', version: 1, myRole: 'manager' });
      expect(view.capabilities).toContain('project-member:manage');
      expect(bed.projectMembers.rows).toEqual([]);
      expect(bed.organizationAccess.shareLocks).toEqual([ORG]);
    },
  );

  it('CA-01: the member who creates becomes manager, and the project gets the default workflow', async () => {
    const bed = world();
    const view = await create(bed, 'bia', 'member');

    expect(view.myRole).toBe('manager');
    expect(bed.projectMembers.rows).toEqual([
      expect.objectContaining({ projectId: view.id, userId: 'bia', role: 'manager' }),
    ]);
    const workflow = await new GetWorkflowUseCase(bed).execute(as('bia', 'member'), view.id);
    expect(workflow.statuses.map((status) => status.category)).toEqual([
      'todo',
      'in_progress',
      'done',
    ]);
    expect(bed.securityEvents.events).toEqual([
      {
        type: 'projects.created',
        requestId: 'req-1',
        organizationId: ORG,
        actorUserId: 'bia',
        projectId: view.id,
      },
    ]);
  });

  it('BR-024: with the setting off, members cannot create; owner and admin still can', async () => {
    const bed = world();
    const organization = bed.organizationAccess.organizations.get(ORG);
    if (organization) organization.membersCanCreateProjects = false;

    await expect(create(bed, 'bia', 'member')).rejects.toBeInstanceOf(InsufficientRoleError);
    await expect(create(bed, 'ana', 'owner')).resolves.toMatchObject({ key: 'WEB' });
  });

  it('BR-024: a viewer never creates — fast denial, without locking', async () => {
    const bed = world();

    await expect(create(bed, 'vivi', 'viewer')).rejects.toBeInstanceOf(InsufficientRoleError);
    expect(bed.organizationAccess.shareLocks).toEqual([]);
  });

  it('decides on the role reread under the lock, not on the middleware role', async () => {
    const bed = world();
    // O middleware viu "member", mas o papel atual é viewer (rebaixado no meio).
    bed.organizationAccess.setMember(ORG, 'bia', 'viewer');

    await expect(create(bed, 'bia', 'member')).rejects.toBeInstanceOf(InsufficientRoleError);
    bed.organizationAccess.organizations.get(ORG)?.roles.delete('caio');
    await expect(create(bed, 'caio', 'member')).rejects.toBeInstanceOf(OrganizationNotFoundError);
  });

  it('CA-02: an invalid key is refused before any write; a repeated key after the permission check', async () => {
    const bed = world();
    await create(bed, 'ana', 'owner');

    await expect(create(bed, 'ana', 'owner', 'web')).rejects.toBeInstanceOf(InvalidProjectKeyError);
    await expect(create(bed, 'bia', 'member', 'WEB')).rejects.toBeInstanceOf(ProjectKeyTakenError);
    // 403 antes de PROJECT_KEY_TAKEN: viewer não descobre chaves.
    await expect(create(bed, 'vivi', 'viewer', 'WEB')).rejects.toBeInstanceOf(
      InsufficientRoleError,
    );
    // Nada sobra da tentativa que falhou (mesma transação).
    expect(bed.projectMembers.rows).toEqual([]);
    expect(bed.projects.rows).toHaveLength(1);
  });

  it('CA-02: the same key is accepted in another organization', async () => {
    const bed = world();
    bed.organizationAccess.setMember('org-b', 'zeca', 'owner');
    await create(bed, 'ana', 'owner');

    await expect(
      new CreateProjectUseCase(bed).execute(as('zeca', 'owner', 'org-b'), {
        key: 'WEB',
        name: 'Web B',
      }),
    ).resolves.toMatchObject({ key: 'WEB' });
  });

  it('RNF-06: counts every attempt and stops at the organization limit', async () => {
    const bed = world();
    const consume = vi.spyOn(bed.rateLimiter, 'consume');
    vi.spyOn(bed.projects, 'countInOrganization').mockResolvedValue(MAX_PROJECTS_PER_ORGANIZATION);

    await expect(create(bed, 'ana', 'owner')).rejects.toBeInstanceOf(ProjectLimitReachedError);
    expect(consume).toHaveBeenCalledWith(PROJECT_CREATION_POLICY, 'ana');
  });
});

describe('ListProjectsUseCase and GetProjectUseCase (RF-02, RF-03, BR-023)', () => {
  async function seeded() {
    const bed = world();
    const web = await create(bed, 'ana', 'owner', 'WEB', 'Website');
    const app = await create(bed, 'ana', 'owner', 'APP', 'Aplicativo');
    const old = await create(bed, 'ana', 'owner', 'OLD', 'Antigo');
    await new ArchiveProjectUseCase(bed).execute(as('ana', 'owner'), {
      projectId: old.id,
      version: 1,
    });
    await participate(bed, web.id, 'bia', 'member');
    return { bed, web, app, old };
  }

  it('CA-03: members only see what they participate in; owner and admin see everything', async () => {
    const { bed } = await seeded();
    const list = new ListProjectsUseCase(bed);

    expect((await list.execute(as('bia', 'member'), {})).items.map((item) => item.key)).toEqual([
      'WEB',
    ]);
    expect((await list.execute(as('caio', 'member'), {})).items).toEqual([]);
    expect(
      (await list.execute(as('adm', 'admin'), {})).items.map((item) => [item.key, item.myRole]),
    ).toEqual([
      ['APP', 'manager'],
      ['WEB', 'manager'],
    ]);
    expect(
      (await list.execute(as('ana', 'owner'), { archived: true })).items.map((item) => item.key),
    ).toEqual(['OLD']);
  });

  it('BR-023: visibility is filtered by the query, so pages stay full', async () => {
    const { bed } = await seeded();

    // "Aplicativo" vem antes de "Website" por nome: sem o filtro na consulta, a primeira página
    // de bia viria vazia (o projeto invisível seria descartado depois).
    const page = await new ListProjectsUseCase(bed).execute(as('bia', 'member'), { limit: 1 });

    expect(page).toEqual({ items: [expect.objectContaining({ key: 'WEB' })], nextCursor: null });
  });

  it('CA-03: a project without access answers 404, by id and by key, like a missing one', async () => {
    const { bed, app } = await seeded();
    const get = new GetProjectUseCase(bed);

    await expect(get.execute(as('bia', 'member'), { projectId: app.id })).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    await expect(get.execute(as('bia', 'member'), { key: 'APP' })).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    await expect(get.execute(as('bia', 'member'), { key: 'NOPE' })).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    await expect(
      new GetWorkflowUseCase(bed).execute(as('bia', 'member'), app.id),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(get.execute(as('bia', 'member'), { key: 'WEB' })).resolves.toMatchObject({
      myRole: 'member',
    });
  });

  it('CA-04: a viewer of the organization with a manager participation reads as viewer', async () => {
    const { bed, web } = await seeded();
    await participate(bed, web.id, 'vivi', 'manager'); // gravado antes de um rebaixamento

    const view = await new GetProjectUseCase(bed).execute(as('vivi', 'viewer'), {
      projectId: web.id,
    });

    expect(view).toMatchObject({ myRole: 'viewer', capabilities: ['project:read'] });
  });

  it('CA-04: an owner who does not participate reads the project as manager', async () => {
    const { bed, app } = await seeded();

    expect(
      await new GetProjectUseCase(bed).execute(as('ana', 'owner'), { key: 'APP' }),
    ).toMatchObject({
      id: app.id,
      myRole: 'manager',
    });
  });
});

describe('UpdateProject, ArchiveProject and RestoreProject (RF-04, RF-05, BR-008, BR-026)', () => {
  async function seeded() {
    const bed = world();
    const web = await create(bed, 'bia', 'member');
    await participate(bed, web.id, 'caio', 'member');
    return { bed, web };
  }
  const update = (
    bed: ProjectsTestbed,
    userId: string,
    role: OrganizationRole,
    projectId: string,
    version = 1,
  ) =>
    new UpdateProjectUseCase(bed).execute(as(userId, role), {
      projectId,
      description: 'Novo',
      version,
    });

  it('CA-05: the manager edits with the version; the key never changes', async () => {
    const { bed, web } = await seeded();

    const view = await update(bed, 'bia', 'member', web.id);

    expect(view).toMatchObject({ key: 'WEB', description: 'Novo', version: 2 });
    expect(bed.projects.locks).toEqual([web.id]);
    expect(bed.organizationAccess.shareLocks.at(-1)).toBe(ORG);
    await expect(update(bed, 'bia', 'member', web.id, 1)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
  });

  it('decides writes on the role reread under the lock, not on the middleware role', async () => {
    const { bed, web } = await seeded();
    // O middleware viu "admin", mas adm foi rebaixado a member e não participa do projeto.
    bed.organizationAccess.setMember(ORG, 'adm', 'member');

    await expect(update(bed, 'adm', 'admin', web.id)).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('CA-05: a project member cannot edit (403); a non participant gets 404', async () => {
    const { bed, web } = await seeded();

    await expect(update(bed, 'caio', 'member', web.id)).rejects.toBeInstanceOf(
      InsufficientRoleError,
    );
    await expect(update(bed, 'vivi', 'viewer', web.id)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    await expect(update(bed, 'bia', 'member', 'missing')).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it('BR-026: archived refuses edits, archive and restore are idempotent, restore brings writes back', async () => {
    const { bed, web } = await seeded();
    const archive = new ArchiveProjectUseCase(bed);
    const restore = new RestoreProjectUseCase(bed);

    const archived = await archive.execute(as('bia', 'member'), { projectId: web.id, version: 1 });
    expect(archived).toMatchObject({
      version: 2,
      capabilities: ['project:read', 'project:archive'],
    });
    expect(archived.archivedAt).not.toBeNull();
    // Já arquivado: 200 com a versão atual, sem conflito mesmo com versão velha.
    await expect(
      archive.execute(as('bia', 'member'), { projectId: web.id, version: 1 }),
    ).resolves.toMatchObject({
      version: 2,
    });
    // Arquivado antes da versão: 409 PROJECT_ARCHIVED mesmo com versão velha.
    await expect(update(bed, 'bia', 'member', web.id, 1)).rejects.toBeInstanceOf(
      ProjectArchivedError,
    );
    await expect(
      restore.execute(as('bia', 'member'), { projectId: web.id, version: 1 }),
    ).rejects.toBeInstanceOf(VersionConflictError);

    const restored = await restore.execute(as('bia', 'member'), { projectId: web.id, version: 2 });
    expect(restored).toMatchObject({ version: 3, archivedAt: null });
    await expect(update(bed, 'bia', 'member', web.id, 3)).resolves.toMatchObject({ version: 4 });
    expect(bed.securityEvents.events.map((event) => event.type)).toEqual([
      'projects.created',
      'projects.archived',
      'projects.restored',
      'projects.updated',
    ]);
  });

  it('CA-05: archiving requires project:archive', async () => {
    const { bed, web } = await seeded();

    await expect(
      new ArchiveProjectUseCase(bed).execute(as('caio', 'member'), {
        projectId: web.id,
        version: 1,
      }),
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});
