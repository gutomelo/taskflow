import express, { type RequestHandler } from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request, { type Response } from 'supertest';
import type { OrganizationRole } from '@taskflow/backend/shared/kernel';
import {
  createCsrfProtection,
  createErrorHandler,
  createTenantScope,
  HttpError,
  notFoundHandler,
} from '@taskflow/backend/shared/http';
import {
  AddProjectMemberUseCase,
  ArchiveProjectUseCase,
  ChangeProjectMemberRoleUseCase,
  CreateProjectUseCase,
  GetProjectUseCase,
  GetWorkflowUseCase,
  ListMemberCandidatesUseCase,
  ListProjectMembersUseCase,
  ListProjectsUseCase,
  RemoveProjectMemberUseCase,
  RestoreProjectUseCase,
  UpdateProjectUseCase,
} from '@taskflow/backend/projects/application';
import {
  createProjectsTestbed,
  type ProjectsTestbed,
} from '@taskflow/backend/projects/application/testing';
import {
  memberCandidatePageSchema,
  problemDetailsSchema,
  projectMemberPageSchema,
  projectMemberSchema,
  projectPageSchema,
  projectSchema,
  workflowSchema,
} from '@taskflow/contracts';
import { projectsErrorMappings } from './projects-error-mappings';
import { PROJECTS_RATE_LIMITS } from './projects-rate-limits';
import { createProjectsRouter } from './projects-router';

const APP_ORIGIN = 'http://localhost:4200';
const ORG = '0192a000-0000-7000-8000-00000000f0f0';
const MIA = '0192a000-0000-7000-8000-00000000a1a1'; // member, cria os projetos
const BIA = '0192a000-0000-7000-8000-00000000b1b1'; // member
const CAIO = '0192a000-0000-7000-8000-00000000c1c1'; // member, não participa
const VIVI = '0192a000-0000-7000-8000-00000000d1d1'; // viewer
const ADM = '0192a000-0000-7000-8000-00000000e1e1'; // admin
const MISSING = '0192a000-0000-7000-8000-000000000999';

function buildApp(bed: ProjectsTestbed) {
  const csrf = createCsrfProtection({
    appOrigin: APP_ORIGIN,
    secret: 's'.repeat(43),
    secureCookie: true,
  });
  const authenticate: RequestHandler = (req, _res, next) => {
    const userId = req.get('x-test-user');
    if (!userId) {
      next(new HttpError(401, 'UNAUTHENTICATED', 'Sessão necessária'));
      return;
    }
    req.actor = { userId, sessionId: `s-${userId}` };
    next();
  };
  const router = createProjectsRouter({
    useCases: {
      createProject: new CreateProjectUseCase(bed),
      listProjects: new ListProjectsUseCase(bed),
      getProject: new GetProjectUseCase(bed),
      getWorkflow: new GetWorkflowUseCase(bed),
      updateProject: new UpdateProjectUseCase(bed),
      archiveProject: new ArchiveProjectUseCase(bed),
      restoreProject: new RestoreProjectUseCase(bed),
      listMembers: new ListProjectMembersUseCase(bed),
      listMemberCandidates: new ListMemberCandidatesUseCase(bed),
      addMember: new AddProjectMemberUseCase(bed),
      changeMemberRole: new ChangeProjectMemberRoleUseCase(bed),
      removeMember: new RemoveProjectMemberUseCase(bed),
    },
    rateLimiter: bed.rateLimiter,
  });
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.use(express.json());
  app.get('/test/csrf', authenticate, (req, res) => {
    csrf.issue(res, req.actor?.sessionId);
    res.status(204).end();
  });
  app.use(
    '/api/v1',
    createTenantScope({
      authenticate,
      csrf,
      // Membership do middleware a partir dos papéis do fake (como ResolveTenantMembership).
      resolve: async ({ userId, organizationId }) => {
        const role = (await bed.organizationAccess.rolesOf(organizationId, [userId])).get(userId);
        return role ? { organizationRole: role } : null;
      },
      routers: [router],
    }),
  );
  app.use(notFoundHandler);
  app.use(createErrorHandler({ domainErrors: projectsErrorMappings }));
  return app;
}

function clientFor(app: express.Express, userId: string) {
  let csrfToken: string | null = null;
  const token = async (): Promise<string> => {
    if (csrfToken) return csrfToken;
    const response = await request(app).get('/test/csrf').set('x-test-user', userId);
    const raw = response.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [raw]).find((value) =>
      value?.startsWith('__Host-tf_csrf='),
    );
    const issued = cookie?.split(';')[0]?.slice('__Host-tf_csrf='.length) ?? '';
    csrfToken = issued;
    return issued;
  };

  const mutate = async (method: 'post' | 'patch' | 'delete', path: string, body?: object) => {
    const value = await token();
    return request(app)
      [method](`/api/v1/organizations/${ORG}${path}`)
      .set('x-test-user', userId)
      .set('Cookie', [`__Host-tf_csrf=${value}`])
      .set('Origin', APP_ORIGIN)
      .set('X-CSRF-Token', value)
      .send(body);
  };
  return {
    get: (path: string) =>
      request(app).get(`/api/v1/organizations/${ORG}${path}`).set('x-test-user', userId),
    post: (path: string, body?: object) => mutate('post', path, body),
    patch: (path: string, body?: object) => mutate('patch', path, body),
    delete: (path: string) => mutate('delete', path),
  };
}

function problem(response: Response) {
  expect(response.headers['content-type']).toContain('application/problem+json');
  return problemDetailsSchema.parse(response.body);
}

async function world() {
  const bed = createProjectsTestbed();
  const roles: Array<[string, OrganizationRole]> = [
    [MIA, 'member'],
    [BIA, 'member'],
    [CAIO, 'member'],
    [VIVI, 'viewer'],
    [ADM, 'admin'],
  ];
  for (const [userId, role] of roles) {
    bed.organizationAccess.setMember(ORG, userId, role);
    bed.users.add({
      id: userId,
      name: `Nome ${userId.slice(-4)}`,
      email: `${userId.slice(-4)}@exemplo.com`,
    });
  }
  const app = buildApp(bed);
  const mia = clientFor(app, MIA);
  const created = await mia.post('/projects', { key: 'WEB', name: 'Website', description: 'Site' });
  const project = projectSchema.parse(created.body);
  await mia.post(`/projects/${project.id}/members`, { userId: BIA, role: 'member' });
  return { bed, app, mia, project };
}

describe('projects router (spec 003, T8)', () => {
  it('POST /projects creates with Location, contract and no-store; invalid and taken keys are explained', async () => {
    const bed = createProjectsTestbed();
    bed.organizationAccess.setMember(ORG, MIA, 'member');
    const mia = clientFor(buildApp(bed), MIA);

    const created = await mia.post('/projects', { key: 'WEB', name: 'Website' });

    expect(created.status).toBe(201);
    const project = projectSchema.parse(created.body);
    expect(created.headers['location']).toBe(`/api/v1/organizations/${ORG}/projects/${project.id}`);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(project).toMatchObject({ key: 'WEB', myRole: 'manager', archivedAt: null, version: 1 });
    expect(problem(await mia.post('/projects', { key: 'web', name: 'X1' }))).toMatchObject({
      status: 400,
      code: 'INVALID_PROJECT_KEY',
    });
    expect(problem(await mia.post('/projects', { key: 'WEB', name: 'Outro' }))).toMatchObject({
      status: 409,
      code: 'PROJECT_KEY_TAKEN',
    });
    expect(
      problem(await mia.post('/projects', { key: 'NEW', name: 'Novo', organizationId: ORG }))
        .status,
    ).toBe(400);
  });

  it('lists visible projects and reads by id and by key; no access answers like a missing project', async () => {
    const { app, mia, project } = await world();
    const caio = clientFor(app, CAIO);

    const list = projectPageSchema.parse((await mia.get('/projects')).body);
    expect(list.items.map((item) => item.key)).toEqual(['WEB']);
    expect(projectPageSchema.parse((await caio.get('/projects')).body).items).toEqual([]);
    expect(projectSchema.parse((await mia.get('/projects/by-key/WEB')).body).id).toBe(project.id);

    const hidden = problem(await caio.get(`/projects/${project.id}`));
    const missing = problem(await caio.get(`/projects/${MISSING}`));
    const hiddenByKey = problem(await caio.get('/projects/by-key/WEB'));
    for (const body of [hidden, missing, hiddenByKey]) {
      expect(body).toMatchObject({
        status: 404,
        code: 'PROJECT_NOT_FOUND',
        title: 'Projeto não encontrado',
      });
    }
    expect(problem(await mia.get('/projects/not-a-uuid')).code).toBe('PROJECT_NOT_FOUND');
    expect(problem(await mia.get(`/projects/by-key/${'X'.repeat(30)}`)).code).toBe(
      'PROJECT_NOT_FOUND',
    );
    // Chave fora do formato da BR-025: 404 sem chegar ao caso de uso (nem ao banco).
    const getProject = vi.spyOn(GetProjectUseCase.prototype, 'execute');
    expect(problem(await mia.get('/projects/by-key/web')).code).toBe('PROJECT_NOT_FOUND');
    expect(getProject).not.toHaveBeenCalled();
    expect(problem(await mia.get('/projects?status=all')).status).toBe(400);
  });

  it('PATCH edits with the version; archive and restore follow BR-026', async () => {
    const { mia, project } = await world();

    const edited = await mia.patch(`/projects/${project.id}`, { description: null, version: 1 });
    expect(projectSchema.parse(edited.body)).toMatchObject({ description: null, version: 2 });
    expect(problem(await mia.patch(`/projects/${project.id}`, { version: 2 })).status).toBe(400);
    expect(
      problem(await mia.patch(`/projects/${project.id}`, { key: 'NEW', version: 2 })).status,
    ).toBe(400);
    expect(
      problem(await mia.patch(`/projects/${project.id}`, { name: 'Novo', version: 1 })).code,
    ).toBe('VERSION_CONFLICT');

    const archived = projectSchema.parse(
      (await mia.post(`/projects/${project.id}/archive`, { version: 2 })).body,
    );
    expect(archived.capabilities).toEqual(['project:read', 'project:archive']);
    expect(
      problem(await mia.patch(`/projects/${project.id}`, { name: 'Novo', version: 3 })),
    ).toMatchObject({
      status: 409,
      code: 'PROJECT_ARCHIVED',
    });
    expect((await mia.get('/projects?status=archived')).body.items).toHaveLength(1);
    const restored = await mia.post(`/projects/${project.id}/restore`, { version: 3 });
    expect(projectSchema.parse(restored.body)).toMatchObject({ archivedAt: null, version: 4 });
  });

  it('GET workflow returns the default statuses and transitions', async () => {
    const { mia, project } = await world();

    const workflow = workflowSchema.parse((await mia.get(`/projects/${project.id}/workflow`)).body);

    expect(workflow.statuses.map((status) => status.name)).toEqual([
      'A fazer',
      'Em andamento',
      'Concluído',
    ]);
    expect(workflow.transitions).toHaveLength(4);
  });

  it('participants: list, candidates, add, change, remove and leave, with the errors of BR-027', async () => {
    const { app, mia, project } = await world();
    const base = `/projects/${project.id}/members`;

    const members = projectMemberPageSchema.parse((await mia.get(base)).body);
    expect(members.items.map((item) => [item.role, item.actions.leave])).toEqual([
      ['manager', true],
      ['member', false],
    ]);
    const candidates = memberCandidatePageSchema.parse(
      (await mia.get(`/projects/${project.id}/member-candidates`)).body,
    );
    expect(candidates.items.map((item) => [item.userId, item.allowedRoles])).toEqual([
      [CAIO, ['manager', 'member', 'viewer']],
      [VIVI, ['viewer']],
    ]);

    expect(problem(await mia.post(base, { userId: MISSING, role: 'member' }))).toMatchObject({
      status: 404,
      code: 'MEMBER_NOT_FOUND',
    });
    expect(problem(await mia.post(base, { userId: VIVI, role: 'member' }))).toMatchObject({
      status: 422,
      code: 'PROJECT_ROLE_ABOVE_CEILING',
    });
    expect(problem(await mia.post(base, { userId: ADM, role: 'viewer' }))).toMatchObject({
      status: 422,
      code: 'ALREADY_MANAGES_ALL_PROJECTS',
    });
    expect(problem(await mia.post(base, { userId: BIA, role: 'viewer' }))).toMatchObject({
      status: 409,
      code: 'ALREADY_A_PROJECT_MEMBER',
    });
    const added = await mia.post(base, { userId: CAIO, role: 'viewer' });
    expect(added.status).toBe(201);
    expect(projectMemberSchema.parse(added.body)).toMatchObject({ userId: CAIO, role: 'viewer' });

    const changed = await mia.patch(`${base}/${CAIO}`, { role: 'member', version: 1 });
    expect(projectMemberSchema.parse(changed.body)).toMatchObject({ role: 'member', version: 2 });
    expect(
      problem(await mia.patch(`${base}/not-a-uuid`, { role: 'member', version: 1 })).code,
    ).toBe('PROJECT_MEMBER_NOT_FOUND');
    expect((await mia.delete(`${base}/${CAIO}?version=2`)).status).toBe(204);
    expect((await clientFor(app, BIA).delete(`${base}/${BIA}?version=1`)).status).toBe(204);
  });

  it('a project member gets 403 on management, before any state error', async () => {
    const { app, project } = await world();
    const bia = clientFor(app, BIA);

    for (const target of [MISSING, CAIO, VIVI]) {
      expect(
        problem(
          await bia.post(`/projects/${project.id}/members`, { userId: target, role: 'manager' }),
        ),
      ).toMatchObject({
        status: 403,
        code: 'INSUFFICIENT_ROLE',
      });
    }
    expect(problem(await bia.get(`/projects/${project.id}/member-candidates`)).status).toBe(403);
  });

  it('limits project edits per user (security events would flood the log otherwise)', async () => {
    const { bed, mia, project } = await world();
    vi.spyOn(bed.rateLimiter, 'consume').mockImplementation(async (policy) =>
      policy.name === PROJECTS_RATE_LIMITS.updateByUser.name
        ? { allowed: false, retryAfterSeconds: 60 }
        : { allowed: true, remainingPoints: 1 },
    );

    const response = await mia.patch(`/projects/${project.id}`, { name: 'Novo', version: 1 });

    expect(problem(response)).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  });

  it('limits member writes per user (429 with Retry-After)', async () => {
    const { bed, mia, project } = await world();
    vi.spyOn(bed.rateLimiter, 'consume').mockImplementation(async (policy) =>
      policy.name === PROJECTS_RATE_LIMITS.memberWritesByUser.name
        ? { allowed: false, retryAfterSeconds: 60 }
        : { allowed: true, remainingPoints: 1 },
    );

    const response = await mia.post(`/projects/${project.id}/members`, {
      userId: CAIO,
      role: 'member',
    });

    expect(problem(response)).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(response.headers['retry-after']).toBe('60');
  });
});
