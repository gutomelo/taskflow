import { Router, type RequestHandler } from 'express';
import {
  createAuthenticate,
  createCsrfProtection,
  createTenantScope,
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
import { createOrganizationsRouters } from '@taskflow/backend/organizations/http';
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
  return composeApiRouters({
    identityRouter,
    authenticate,
    csrf,
    organizations: { ...routers, resolveTenant: (input) => resolve.execute(input) },
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

    expect(coverageGaps(routes, { [routes[0] ?? '']: { references: {} } })).toEqual([
      'DELETE /organizations/:organizationId/things/:thingId: no variant for :thingId',
    ]);
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
