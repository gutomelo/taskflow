import {
  CreateCommentUseCase,
  DeleteCommentUseCase,
  EditCommentUseCase,
  GetCommentUseCase,
  ListCommentsUseCase,
  ListMentionCandidatesUseCase,
} from '@taskflow/backend/collaboration/application';
import { createCollaborationTestbed } from '@taskflow/backend/collaboration/application/testing';
import { createCollaborationRouter } from '@taskflow/backend/collaboration/http';
import {
  CountUnreadUseCase,
  GetNotificationPreferenceUseCase,
  ListNotificationsUseCase,
  MarkAllReadUseCase,
  MarkReadUseCase,
  UpdateNotificationPreferenceUseCase,
} from '@taskflow/backend/notifications/application';
import { createNotificationsTestbed } from '@taskflow/backend/notifications/application/testing';
import { createNotificationsRouters } from '@taskflow/backend/notifications/http';
import { commentBodySchema } from '@taskflow/contracts';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  createAuthenticate,
  createCsrfProtection,
  createTenantScope,
  noStore as sharedNoStore,
} from '@taskflow/backend/shared/http';
import {
  ChangePasswordUseCase,
  ConfirmEmailVerificationUseCase,
  EmailDeliveryThrottle,
  GetCurrentUserUseCase,
  ListSessionsUseCase,
  LoginUseCase,
  LogoutUseCase,
  RefreshSessionUseCase,
  RegisterUserUseCase,
  RequestPasswordResetUseCase,
  ResendEmailVerificationUseCase,
  ResetPasswordUseCase,
  RevokeSessionUseCase,
} from '@taskflow/backend/identity/application';
import { createIdentityTestbed } from '@taskflow/backend/identity/application/testing';
import { createIdentityRouter } from '@taskflow/backend/identity/http';
import {
  AcceptInvitationUseCase,
  ChangeMemberRoleUseCase,
  CreateOrganizationUseCase,
  GetOrganizationUseCase,
  InviteMemberUseCase,
  ListInvitationsUseCase,
  ListMembersUseCase,
  ListMyOrganizationsUseCase,
  LookupInvitationUseCase,
  RemoveMemberUseCase,
  ResendInvitationUseCase,
  ResolveTenantMembershipUseCase,
  RevokeInvitationUseCase,
  UpdateOrganizationUseCase,
} from '@taskflow/backend/organizations/application';
import { createOrganizationsTestbed } from '@taskflow/backend/organizations/application/testing';
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
  CreateStatusUseCase,
  RemoveProjectMemberUseCase,
  RemoveStatusUseCase,
  ReorderStatusesUseCase,
  ReplaceTransitionsUseCase,
  UpdateStatusUseCase,
  RestoreProjectUseCase,
  UpdateProjectUseCase,
} from '@taskflow/backend/projects/application';
import { createProjectsTestbed } from '@taskflow/backend/projects/application/testing';
import { createProjectsRouter } from '@taskflow/backend/projects/http';
import { createOrganizationsRouters } from '@taskflow/backend/organizations/http';
import {
  AddDependencyUseCase,
  AssignTaskUseCase,
  CancelTaskUseCase,
  CreateTaskUseCase,
  DeleteTaskUseCase,
  GetBoardUseCase,
  GetTaskUseCase,
  ListColumnCardsUseCase,
  MoveCardUseCase,
  ListAssignableUsersUseCase as ListAssignableTaskUsersUseCase,
  ListTasksUseCase,
  RemoveDependencyUseCase,
  ReopenTaskUseCase,
  TransitionTaskUseCase,
  UpdateTaskUseCase,
} from '@taskflow/backend/tasks/application';
import { createTasksTestbed } from '@taskflow/backend/tasks/application/testing';
import { createTasksRouter } from '@taskflow/backend/tasks/http';
import { GLOBAL_ROUTES, ISOLATION_CASES } from '../testing/isolation-cases';
import {
  coverageGaps,
  globalViolations,
  listGlobalRoutes,
  listTenantRoutes,
} from '../testing/tenant-isolation';
import { composeApiRouters } from './api-routers';

const csrf = createCsrfProtection({
  appOrigin: 'http://localhost:4200',
  secret: 's'.repeat(43),
  secureCookie: true,
});

/** A composição real (`composeApiRouters`) com os routers reais sobre fakes: só a forma importa. */
function composed() {
  const identity = createIdentityTestbed();
  const throttle = new EmailDeliveryThrottle(identity.rateLimiter, identity.pseudonymizer);
  const resolveActor = async () => null;
  const identityRouter = createIdentityRouter({
    useCases: {
      register: new RegisterUserUseCase({ ...identity, emailThrottle: throttle }),
      login: new LoginUseCase({ ...identity, dummyPasswordHash: 'fake-hash:dummy' }),
      getCurrentUser: new GetCurrentUserUseCase(identity),
      logout: new LogoutUseCase(identity),
      refreshSession: new RefreshSessionUseCase(identity),
      listSessions: new ListSessionsUseCase(identity),
      revokeSession: new RevokeSessionUseCase(identity),
      resendEmailVerification: new ResendEmailVerificationUseCase({
        ...identity,
        emailThrottle: throttle,
      }),
      confirmEmailVerification: new ConfirmEmailVerificationUseCase(identity),
      changePassword: new ChangePasswordUseCase(identity),
      requestPasswordReset: new RequestPasswordResetUseCase({
        ...identity,
        emailThrottle: throttle,
      }),
      resetPassword: new ResetPasswordUseCase(identity),
    },
    csrf,
    authenticate: createAuthenticate({ cookieName: '__Host-tf_at', resolveActor }),
    authenticateOptional: createAuthenticate({
      cookieName: '__Host-tf_at',
      resolveActor,
      required: false,
    }),
    accessTokens: identity.accessTokens,
    pseudonymizer: identity.pseudonymizer,
    rateLimiter: identity.rateLimiter,
  });
  const bed = createOrganizationsTestbed();
  const authenticate: RequestHandler = (_request, _response, next) => next();
  const routers = createOrganizationsRouters({
    useCases: {
      createOrganization: new CreateOrganizationUseCase(bed),
      listMyOrganizations: new ListMyOrganizationsUseCase(bed),
      getOrganization: new GetOrganizationUseCase(bed),
      updateOrganization: new UpdateOrganizationUseCase(bed),
      listMembers: new ListMembersUseCase(bed),
      changeMemberRole: new ChangeMemberRoleUseCase(bed),
      removeMember: new RemoveMemberUseCase(bed),
      listInvitations: new ListInvitationsUseCase(bed),
      inviteMember: new InviteMemberUseCase(bed),
      resendInvitation: new ResendInvitationUseCase(bed),
      revokeInvitation: new RevokeInvitationUseCase(bed),
      lookupInvitation: new LookupInvitationUseCase(bed),
      acceptInvitation: new AcceptInvitationUseCase(bed),
    },
    authenticate,
    csrf,
    rateLimiter: bed.rateLimiter,
  });
  const resolve = new ResolveTenantMembershipUseCase(bed);
  const projectsBed = createProjectsTestbed();
  const projectsRouter = createProjectsRouter({
    useCases: {
      createProject: new CreateProjectUseCase(projectsBed),
      listProjects: new ListProjectsUseCase(projectsBed),
      getProject: new GetProjectUseCase(projectsBed),
      getWorkflow: new GetWorkflowUseCase(projectsBed),
      updateProject: new UpdateProjectUseCase(projectsBed),
      archiveProject: new ArchiveProjectUseCase(projectsBed),
      restoreProject: new RestoreProjectUseCase(projectsBed),
      listMembers: new ListProjectMembersUseCase(projectsBed),
      listMemberCandidates: new ListMemberCandidatesUseCase(projectsBed),
      addMember: new AddProjectMemberUseCase(projectsBed),
      changeMemberRole: new ChangeProjectMemberRoleUseCase(projectsBed),
      removeMember: new RemoveProjectMemberUseCase(projectsBed),
      createStatus: new CreateStatusUseCase(projectsBed),
      updateStatus: new UpdateStatusUseCase(projectsBed),
      removeStatus: new RemoveStatusUseCase(projectsBed),
      reorderStatuses: new ReorderStatusesUseCase(projectsBed),
      replaceTransitions: new ReplaceTransitionsUseCase(projectsBed),
    },
    rateLimiter: projectsBed.rateLimiter,
  });
  const tasksBed = createTasksTestbed();
  const tasksRouter = createTasksRouter({
    useCases: {
      createTask: new CreateTaskUseCase(tasksBed),
      listTasks: new ListTasksUseCase(tasksBed),
      getTask: new GetTaskUseCase(tasksBed),
      listAssignableUsers: new ListAssignableTaskUsersUseCase(tasksBed),
      updateTask: new UpdateTaskUseCase(tasksBed),
      assignTask: new AssignTaskUseCase(tasksBed),
      transitionTask: new TransitionTaskUseCase(tasksBed),
      cancelTask: new CancelTaskUseCase(tasksBed),
      reopenTask: new ReopenTaskUseCase(tasksBed),
      deleteTask: new DeleteTaskUseCase(tasksBed),
      addDependency: new AddDependencyUseCase(tasksBed),
      removeDependency: new RemoveDependencyUseCase(tasksBed),
      getBoard: new GetBoardUseCase(tasksBed),
      listColumnCards: new ListColumnCardsUseCase(tasksBed),
      moveCard: new MoveCardUseCase(tasksBed),
    },
  });
  const collaborationBed = createCollaborationTestbed();
  const collaborationRouter = createCollaborationRouter({
    useCases: {
      listComments: new ListCommentsUseCase(collaborationBed),
      getComment: new GetCommentUseCase(collaborationBed),
      listMentionCandidates: new ListMentionCandidatesUseCase(collaborationBed),
      createComment: new CreateCommentUseCase(collaborationBed),
      editComment: new EditCommentUseCase(collaborationBed),
      deleteComment: new DeleteCommentUseCase(collaborationBed),
    },
  });
  const notificationsBed = createNotificationsTestbed();
  const notificationsRouters = createNotificationsRouters({
    useCases: {
      listNotifications: new ListNotificationsUseCase(notificationsBed),
      countUnread: new CountUnreadUseCase(notificationsBed),
      markRead: new MarkReadUseCase(notificationsBed),
      markAllRead: new MarkAllReadUseCase(notificationsBed),
      getPreference: new GetNotificationPreferenceUseCase(notificationsBed),
      updatePreference: new UpdateNotificationPreferenceUseCase(notificationsBed),
    },
    authenticate,
    csrf,
  });
  return composeApiRouters({
    identityRouter,
    authenticate,
    csrf,
    organizations: { ...routers, resolveTenant: (input) => resolve.execute(input) },
    projects: { tenantRouter: projectsRouter },
    tasks: { tenantRouter: tasksRouter },
    collaboration: { tenantRouter: collaborationRouter },
    notifications: notificationsRouters,
  });
}

describe('route table coverage (spec 006, CA-07)', () => {
  const api = composed();
  const tenantRoutes = listTenantRoutes(api.tenantScope);
  const globalRoutes = listGlobalRoutes(api.globalRouters);

  it('reads the real route table (sanity: an empty reading would test nothing)', () => {
    expect(tenantRoutes.length).toBeGreaterThanOrEqual(9);
    expect(tenantRoutes).toContain('GET /organizations/:organizationId/members');
    expect(globalRoutes).toContain('GET /me');
  });

  it('every tenant route has an isolation case and a variant for each path parameter', () => {
    expect(coverageGaps(tenantRoutes, ISOLATION_CASES)).toEqual([]);
  });

  it('every global route is justified and none carries the tenant', () => {
    expect(globalViolations(globalRoutes, GLOBAL_ROUTES)).toEqual([]);
    expect(Object.keys(GLOBAL_ROUTES).sort()).toEqual([...globalRoutes].sort());
  });
});

describe('isolation harness fails closed', () => {
  const noop: RequestHandler = (_request, response) => {
    response.end();
  };
  const scopeWith = (configure: (router: Router) => void) => {
    const router = Router({ mergeParams: true });
    configure(router);
    return createTenantScope({
      authenticate: noop,
      csrf,
      resolve: async () => null,
      routers: [router],
    });
  };

  it('reports a new tenant route without a case', () => {
    const routes = listTenantRoutes(scopeWith((router) => router.get('/export', noop)));

    expect(coverageGaps(routes, {})).toEqual([
      'GET /organizations/:organizationId/export: no isolation case',
    ]);
  });

  it('reports a missing variant for a path parameter', () => {
    const routes = listTenantRoutes(scopeWith((router) => router.delete('/things/:thingId', noop)));

    expect(
      coverageGaps(routes, { [routes[0] ?? '']: { body: null, query: null, references: {} } }),
    ).toEqual(['DELETE /organizations/:organizationId/things/:thingId: no variant for :thingId']);
  });

  it('spec 003: derives body and query references from the declared schemas', () => {
    const routes = listTenantRoutes(
      scopeWith((router) => router.post('/things', noop).get('/things', noop)),
    );
    const [post = '', get = ''] = routes;

    expect(
      coverageGaps(routes, {
        [post]: {
          body: z.object({ ownerId: z.uuid(), name: z.string() }),
          query: null,
          references: {},
        },
        [get]: { body: null, query: z.object({ cursor: z.string() }), references: {} },
      }),
    ).toEqual([
      'POST /organizations/:organizationId/things: no variant for body.ownerId',
      'GET /organizations/:organizationId/things: no variant for query.cursor',
    ]);
  });

  it('spec 005 (A1): references inside lists and nested objects need variants too', () => {
    const routes = listTenantRoutes(scopeWith((router) => router.put('/things', noop)));

    expect(
      coverageGaps(routes, {
        [routes[0] ?? '']: {
          body: z.strictObject({
            thingIds: z.array(z.uuid()).max(5),
            links: z.array(z.strictObject({ fromThingId: z.uuid(), label: z.string() })).optional(),
            version: z.int(),
          }),
          query: z.object({ moveToThingId: z.uuid().optional() }),
          references: {},
        },
      }),
    ).toEqual([
      'PUT /organizations/:organizationId/things: no variant for body.thingIds',
      'PUT /organizations/:organizationId/things: no variant for body.links[].fromThingId',
      'PUT /organizations/:organizationId/things: no variant for query.moveToThingId',
    ]);
  });

  it('spec 010 (B1): text carrying references (mentions) needs a variant, derived from the schema', () => {
    const routes = listTenantRoutes(scopeWith((router) => router.post('/notes', noop)));
    const gaps = (references: Readonly<Record<string, never>>) =>
      coverageGaps(routes, {
        [routes[0] ?? '']: {
          body: z.strictObject({ text: commentBodySchema, title: z.string().optional() }),
          query: null,
          references,
        },
      });

    expect(gaps({})).toEqual([
      'POST /organizations/:organizationId/notes: no variant for body.text.mentions',
    ]);
    // Um texto qualquer (sem o registro) não exige variante.
    expect(
      coverageGaps(routes, {
        [routes[0] ?? '']: {
          body: z.strictObject({ text: z.string() }),
          query: null,
          references: {},
        },
      }),
    ).toEqual([]);
  });

  it('spec 003: a route that takes a body must declare its schema', () => {
    const routes = listTenantRoutes(scopeWith((router) => router.patch('/things', noop)));

    expect(
      coverageGaps(routes, { [routes[0] ?? '']: { body: null, query: null, references: {} } }),
    ).toEqual(['PATCH /organizations/:organizationId/things: no body schema declared']);
  });

  it('accepts only the shared noStore middleware, by identity (not by name)', () => {
    const noStore: RequestHandler = (_request, _response, next) => next();

    expect(() => listTenantRoutes(scopeWith((router) => router.use(noStore)))).toThrow(
      'is not an allowed middleware',
    );
    expect(listTenantRoutes(scopeWith((router) => router.use(sharedNoStore)))).toEqual([]);
  });

  it('rejects a context router mounted with its own path and unknown route-less layers', () => {
    expect(() =>
      listTenantRoutes(scopeWith((router) => router.use('/hidden', Router().get('/x', noop)))),
    ).toThrow('sub-router mounted with its own path');
    expect(() => listTenantRoutes(scopeWith((router) => router.use(noop)))).toThrow(
      'is not an allowed middleware',
    );
  });

  it('flags a tenant route mounted outside the scope and an unjustified global route', () => {
    const rogue = Router().get('/organizations/:organizationId/export', noop).get('/stats', noop);

    expect(globalViolations(listGlobalRoutes([rogue]), {})).toEqual([
      'GET /organizations/:organizationId/export: tenant route mounted outside the tenant scope',
      'GET /stats: global route without justification',
    ]);
  });

  it('rejects path-mounted middlewares that would hide a handler from the scan', () => {
    const rogue = Router().use('/organizations/:organizationId/export', noop);
    expect(() => listGlobalRoutes([rogue])).toThrow('is not an allowed middleware');

    const scoped = Router({ mergeParams: true }).use('/export', noop);
    const scope = Router().use('/organizations/:organizationId', scoped);
    expect(() => listTenantRoutes(scope)).toThrow('mounted with its own path');
  });
});
