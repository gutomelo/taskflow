import express, { type RequestHandler, type Router } from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request, { type Response } from 'supertest';
import {
  createCsrfProtection,
  createErrorHandler,
  createTenantScope,
  HttpError,
  notFoundHandler,
} from '@taskflow/backend/shared/http';
import {
  Membership,
  Organization,
  OrganizationName,
  OrganizationSlug,
} from '@taskflow/backend/organizations/domain';
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
  UpdateOrganizationUseCase,
  ResendInvitationUseCase,
  ResolveTenantMembershipUseCase,
  RevokeInvitationUseCase,
} from '@taskflow/backend/organizations/application';
import {
  createOrganizationsTestbed,
  type OrganizationsTestbed,
} from '@taskflow/backend/organizations/application/testing';
import {
  invitationPageSchema,
  invitationPreviewSchema,
  invitationSchema,
  memberPageSchema,
  myOrganizationListSchema,
  organizationSchema,
  problemDetailsSchema,
} from '@taskflow/contracts';
import { organizationsErrorMappings } from './organizations-error-mappings';
import { ORGANIZATIONS_RATE_LIMITS } from './organizations-rate-limits';
import { createOrganizationsRouters } from './organizations-router';

const APP_ORIGIN = 'http://localhost:4200';
const ANA = '0192a000-0000-7000-8000-00000000a0a0';
const BIA = '0192a000-0000-7000-8000-00000000b1b1';
const EVA = '0192a000-0000-7000-8000-00000000e0e0';
const UNKNOWN_ORG = '0192a000-0000-7000-8000-000000000999';

function buildApp(bed: OrganizationsTestbed) {
  const csrf = createCsrfProtection({
    appOrigin: APP_ORIGIN,
    secret: 's'.repeat(43),
    secureCookie: true,
  });
  // Como `createAuthenticate`: o ator vem de uma sessão já verificada (aqui, um header de teste).
  const authenticate: RequestHandler = (req, _res, next) => {
    const userId = req.get('x-test-user');
    if (!userId) {
      next(new HttpError(401, 'UNAUTHENTICATED', 'Sessão necessária'));
      return;
    }
    req.actor = { userId, sessionId: `s-${userId}` };
    next();
  };
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
  const resolveMembership = new ResolveTenantMembershipUseCase(bed);
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.use(express.json());
  // Só para o teste obter o token CSRF ligado à sessão do ator (em produção: GET /auth/csrf).
  app.get('/test/csrf', authenticate, (req, res) => {
    csrf.issue(res, req.actor?.sessionId);
    res.status(204).end();
  });
  app.use('/api/v1', routers.router);
  app.use(
    '/api/v1',
    createTenantScope({
      authenticate,
      csrf,
      resolve: (input) => resolveMembership.execute(input),
      routers: [routers.tenantRouter],
    }),
  );
  app.use(notFoundHandler);
  app.use(createErrorHandler({ domainErrors: organizationsErrorMappings }));
  return { app, routers };
}

/** Cliente com sessão e CSRF como o Angular fará. */
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
      [method](`/api/v1${path}`)
      .set('x-test-user', userId)
      .set('Cookie', [`__Host-tf_csrf=${value}`])
      .set('Origin', APP_ORIGIN)
      .set('X-CSRF-Token', value)
      .send(body);
  };
  return {
    get: (path: string) => request(app).get(`/api/v1${path}`).set('x-test-user', userId),
    post: (path: string, body?: object) => mutate('post', path, body),
    patch: (path: string, body?: object) => mutate('patch', path, body),
    delete: (path: string) => mutate('delete', path),
  };
}

function problem(response: Response) {
  expect(response.headers['content-type']).toContain('application/problem+json');
  return problemDetailsSchema.parse(response.body);
}

function addAccount(bed: OrganizationsTestbed, id: string, email: string, emailVerified = true) {
  bed.users.add({ id, name: `Nome ${email.split('@')[0]}`, email, emailVerified });
}

async function seed(
  bed: OrganizationsTestbed,
  members: ReadonlyArray<readonly [string, 'owner' | 'admin' | 'member' | 'viewer']>,
  slug = 'acme',
) {
  const now = bed.clock.now();
  const organization = Organization.create({
    id: bed.idGenerator.generate(),
    name: OrganizationName.create(`Org ${slug}`),
    slug: OrganizationSlug.create(slug),
    now,
  });
  await bed.organizations.add(organization);
  for (const [userId, role] of members) {
    await bed.memberships.add(
      Membership.create({
        id: bed.idGenerator.generate(),
        organizationId: organization.id,
        userId,
        role,
        now,
      }),
    );
  }
  return organization.id;
}

function setup() {
  const bed = createOrganizationsTestbed();
  addAccount(bed, ANA, 'ana@exemplo.com');
  addAccount(bed, BIA, 'bia@exemplo.com');
  addAccount(bed, EVA, 'eva@exemplo.com');
  const { app, routers } = buildApp(bed);
  return {
    bed,
    app,
    routers,
    ana: clientFor(app, ANA),
    bia: clientFor(app, BIA),
    eva: clientFor(app, EVA),
  };
}

describe('organizations HTTP API (spec 002)', () => {
  describe('POST /organizations', () => {
    it('CA-01: creates the organization with Location, the creator as owner', async () => {
      const { ana } = setup();

      const response = await ana.post('/organizations', { name: 'Acme', slug: 'acme' });

      expect(response.status).toBe(201);
      const body = organizationSchema.parse(response.body);
      expect(body).toMatchObject({ name: 'Acme', slug: 'acme', myRole: 'owner', version: 1 });
      expect(response.headers['location']).toBe(`/api/v1/organizations/${body.id}`);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('CA-01 / CA-02: maps unverified e-mail, invalid and taken slugs and unknown fields', async () => {
      const { bed, ana, bia } = setup();
      addAccount(bed, EVA, 'eva@exemplo.com', false);
      const eva = clientFor(buildApp(bed).app, EVA);
      await ana.post('/organizations', { name: 'Acme', slug: 'acme' });

      const unverified = await eva.post('/organizations', { name: 'X Ltda', slug: 'x-ltda' });
      const invalid = await bia.post('/organizations', { name: 'Outra', slug: 'Acme!' });
      const taken = await bia.post('/organizations', { name: 'Outra', slug: 'acme' });
      const unknownField = await bia.post('/organizations', {
        name: 'Outra',
        slug: 'outra',
        ownerId: ANA,
      });

      expect([unverified.status, problem(unverified).code]).toEqual([403, 'EMAIL_NOT_VERIFIED']);
      expect([invalid.status, problem(invalid).code]).toEqual([400, 'INVALID_SLUG']);
      expect([taken.status, problem(taken).code]).toEqual([409, 'SLUG_TAKEN']);
      expect([unknownField.status, problem(unknownField).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('CA-12: answers 429 with Retry-After from the 6th attempt of the day', async () => {
      const { ana } = setup();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await ana.post('/organizations', { name: 'Acme', slug: 'admin' });
      }

      const response = await ana.post('/organizations', { name: 'Acme', slug: 'acme' });

      expect([response.status, problem(response).code]).toEqual([429, 'RATE_LIMITED']);
      expect(response.headers['retry-after']).toBe('86400');
    });

    it('requires a session and CSRF', async () => {
      const { app } = setup();

      const anonymous = await request(app)
        .post('/api/v1/organizations')
        .send({ name: 'Acme', slug: 'acme' });
      const withoutCsrf = await request(app)
        .post('/api/v1/organizations')
        .set('x-test-user', ANA)
        .send({ name: 'Acme', slug: 'acme' });

      expect(anonymous.status).toBe(401);
      expect([withoutCsrf.status, problem(withoutCsrf).code]).toEqual([
        403,
        'CSRF_VALIDATION_FAILED',
      ]);
    });
  });

  it('GET /me/organizations lists the actor organizations (RF-02)', async () => {
    const { bed, ana } = setup();
    const acme = await seed(bed, [[ANA, 'owner']]);
    await seed(bed, [[BIA, 'owner']], 'beta');

    const response = await ana.get('/me/organizations');

    expect(response.status).toBe(200);
    expect(myOrganizationListSchema.parse(response.body)).toEqual({
      items: [
        {
          id: acme,
          name: 'Org acme',
          slug: 'acme',
          role: 'owner',
          capabilities: [
            'organization:read',
            'organization:update',
            'member:invite',
            'member:change-role',
            'member:remove',
            'project:create',
          ],
        },
      ],
    });
  });

  describe('organization (tenant)', () => {
    it('reads with the member role and renames with BR-008 and RBAC', async () => {
      const { bed, ana, bia } = setup();
      const acme = await seed(bed, [
        [ANA, 'admin'],
        [BIA, 'member'],
        [EVA, 'owner'],
      ]);

      const read = await bia.get(`/organizations/${acme}`);
      const forbidden = await bia.patch(`/organizations/${acme}`, { name: 'Tomada', version: 1 });
      const renamed = await ana.patch(`/organizations/${acme}`, {
        name: 'Acme Brasil',
        version: 1,
      });
      const stale = await ana.patch(`/organizations/${acme}`, { name: 'Outra', version: 1 });

      expect(organizationSchema.parse(read.body).myRole).toBe('member');
      expect(read.headers['cache-control']).toBe('no-store');
      expect([forbidden.status, problem(forbidden).code]).toEqual([403, 'INSUFFICIENT_ROLE']);
      expect(organizationSchema.parse(renamed.body)).toMatchObject({
        name: 'Acme Brasil',
        version: 2,
      });
      expect([stale.status, problem(stale).code]).toEqual([409, 'VERSION_CONFLICT']);
    });
  });

  describe('permissions (spec 006)', () => {
    it('CA-03: owner/admin turn off "members can create projects" with the version; members lose project:create', async () => {
      const { bed, ana, bia } = setup();
      const acme = await seed(bed, [
        [ANA, 'admin'],
        [BIA, 'member'],
        [EVA, 'owner'],
      ]);

      const updated = await ana.patch(`/organizations/${acme}`, {
        membersCanCreateProjects: false,
        version: 1,
      });
      const asMember = await bia.get(`/organizations/${acme}`);
      const forbidden = await bia.patch(`/organizations/${acme}`, {
        membersCanCreateProjects: true,
        version: 2,
      });
      const stale = await ana.patch(`/organizations/${acme}`, {
        membersCanCreateProjects: true,
        version: 1,
      });

      expect(organizationSchema.parse(updated.body)).toMatchObject({
        membersCanCreateProjects: false,
        version: 2,
      });
      expect(organizationSchema.parse(asMember.body).capabilities).toEqual(['organization:read']);
      expect([forbidden.status, problem(forbidden).code]).toEqual([403, 'INSUFFICIENT_ROLE']);
      expect([stale.status, problem(stale).code]).toEqual([409, 'VERSION_CONFLICT']);
    });

    it('rejects an update without any field and fields outside the contract', async () => {
      const { bed, ana } = setup();
      const acme = await seed(bed, [[ANA, 'owner']]);

      const empty = await ana.patch(`/organizations/${acme}`, { version: 1 });
      const extra = await ana.patch(`/organizations/${acme}`, {
        version: 1,
        capabilities: ['organization:update'],
      });

      expect([empty.status, problem(empty).code]).toEqual([400, 'VALIDATION_FAILED']);
      expect([extra.status, problem(extra).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('CA-04 / CA-05: a viewer gets read-only capabilities and no member actions', async () => {
      const { bed, eva } = setup();
      const acme = await seed(bed, [
        [ANA, 'owner'],
        [EVA, 'viewer'],
      ]);

      const organization = organizationSchema.parse((await eva.get(`/organizations/${acme}`)).body);
      const members = memberPageSchema.parse(
        (await eva.get(`/organizations/${acme}/members`)).body,
      );
      const mine = myOrganizationListSchema.parse((await eva.get('/me/organizations')).body);

      expect(organization.capabilities).toEqual(['organization:read']);
      expect(mine.items[0]?.capabilities).toEqual(['organization:read']);
      expect(members.items.map((member) => member.actions)).toEqual([
        { changeRoleTo: [], remove: false },
        { changeRoleTo: [], remove: false },
      ]);
    });
  });

  describe('members (tenant)', () => {
    it('pages members by cursor and bounds the page size', async () => {
      const { bed, bia } = setup();
      const acme = await seed(bed, [
        [ANA, 'owner'],
        [BIA, 'member'],
      ]);

      const first = await bia.get(`/organizations/${acme}/members?limit=1`);
      const page = memberPageSchema.parse(first.body);
      const second = await bia.get(
        `/organizations/${acme}/members?limit=1&cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
      );
      const tooBig = await bia.get(`/organizations/${acme}/members?limit=500`);

      expect(page.items.map((member) => member.email)).toEqual(['ana@exemplo.com']);
      expect(memberPageSchema.parse(second.body).items.map((member) => member.userId)).toEqual([
        BIA,
      ]);
      expect([tooBig.status, problem(tooBig).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('CA-07 / CA-08: changes roles, maps LAST_OWNER and 404 for malformed ids', async () => {
      const { bed, ana } = setup();
      const acme = await seed(bed, [
        [ANA, 'owner'],
        [BIA, 'member'],
      ]);

      const promoted = await ana.patch(`/organizations/${acme}/members/${BIA}`, {
        role: 'admin',
        version: 1,
      });
      const lastOwner = await ana.patch(`/organizations/${acme}/members/${ANA}`, {
        role: 'admin',
        version: 1,
      });
      const malformed = await ana.patch(`/organizations/${acme}/members/nao-e-uuid`, {
        role: 'admin',
        version: 1,
      });

      expect(promoted.status).toBe(200);
      expect(memberPageSchema.shape.items.element.parse(promoted.body)).toMatchObject({
        role: 'admin',
        version: 2,
      });
      expect([lastOwner.status, problem(lastOwner).code]).toEqual([409, 'LAST_OWNER']);
      expect([malformed.status, problem(malformed).code]).toEqual([404, 'MEMBER_NOT_FOUND']);
    });

    it('RF-11 / RF-12: removes with the version and requires it', async () => {
      const { bed, ana, bia } = setup();
      const acme = await seed(bed, [
        [ANA, 'owner'],
        [BIA, 'member'],
      ]);

      const withoutVersion = await ana.delete(`/organizations/${acme}/members/${BIA}`);
      const left = await bia.delete(`/organizations/${acme}/members/${BIA}?version=1`);
      const afterLeaving = await bia.get(`/organizations/${acme}`);

      expect([withoutVersion.status, problem(withoutVersion).code]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      expect(left.status).toBe(204);
      expect([afterLeaving.status, problem(afterLeaving).code]).toEqual([
        404,
        'ORGANIZATION_NOT_FOUND',
      ]);
    });
  });

  describe('invitations', () => {
    it('RF-06 / CA-12: creates (201), refuses owner, and limits the same e-mail with Retry-After', async () => {
      const { bed, ana } = setup();
      const acme = await seed(bed, [[ANA, 'owner']]);

      const created = await ana.post(`/organizations/${acme}/invitations`, {
        email: 'nova@exemplo.com',
        role: 'member',
      });
      const owner = await ana.post(`/organizations/${acme}/invitations`, {
        email: 'x@exemplo.com',
        role: 'owner',
      });
      const again = await ana.post(`/organizations/${acme}/invitations`, {
        email: 'nova@exemplo.com',
        role: 'admin',
      });

      expect(created.status).toBe(201);
      expect(invitationSchema.parse(created.body)).toMatchObject({
        email: 'nova@exemplo.com',
        status: 'pending',
      });
      expect([owner.status, problem(owner).code]).toEqual([400, 'VALIDATION_FAILED']);
      expect([again.status, problem(again).code]).toEqual([429, 'RATE_LIMITED']);
      expect(again.headers['retry-after']).toBe('600');
    });

    it('RF-06: re-inviting an open invitation answers 200 with the new role', async () => {
      const { bed, ana } = setup();
      const acme = await seed(bed, [[ANA, 'owner']]);
      await ana.post(`/organizations/${acme}/invitations`, {
        email: 'nova@exemplo.com',
        role: 'viewer',
      });
      bed.rateLimiter.consumed.clear();

      const response = await ana.post(`/organizations/${acme}/invitations`, {
        email: 'nova@exemplo.com',
        role: 'admin',
      });

      expect(response.status).toBe(200);
      expect(invitationSchema.parse(response.body).role).toBe('admin');
    });

    it('RF-07: lists, resends (202) and revokes (204, then 404)', async () => {
      const { bed, ana, bia } = setup();
      const acme = await seed(bed, [
        [ANA, 'owner'],
        [BIA, 'member'],
      ]);
      const created = invitationSchema.parse(
        (
          await ana.post(`/organizations/${acme}/invitations`, {
            email: 'nova@exemplo.com',
            role: 'member',
          })
        ).body,
      );
      bed.rateLimiter.consumed.clear();

      const list = await ana.get(`/organizations/${acme}/invitations`);
      const forbidden = await bia.get(`/organizations/${acme}/invitations`);
      const resent = await ana.post(`/organizations/${acme}/invitations/${created.id}/resend`);
      const revoked = await ana.delete(`/organizations/${acme}/invitations/${created.id}`);
      const again = await ana.delete(`/organizations/${acme}/invitations/${created.id}`);
      const malformed = await ana.delete(`/organizations/${acme}/invitations/123`);

      expect(invitationPageSchema.parse(list.body).items).toHaveLength(1);
      expect([forbidden.status, problem(forbidden).code]).toEqual([403, 'INSUFFICIENT_ROLE']);
      expect(resent.status).toBe(202);
      expect(revoked.status).toBe(204);
      expect([again.status, problem(again).code]).toEqual([404, 'INVITATION_NOT_FOUND']);
      expect([malformed.status, problem(malformed).code]).toEqual([404, 'INVITATION_NOT_FOUND']);
    });

    it('CA-04 / CA-05: previews and accepts by the invited account only', async () => {
      const { bed, ana, bia, eva } = setup();
      const acme = await seed(bed, [[ANA, 'owner']]);
      const created = invitationSchema.parse(
        (
          await ana.post(`/organizations/${acme}/invitations`, {
            email: 'bia@exemplo.com',
            role: 'admin',
          })
        ).body,
      );
      const stored = await bed.invitations.findById(acme, created.id);
      const { token, tokenHash } = bed.tokens.generate();
      await bed.invitations.issueToken({
        invitationId: created.id,
        deliveryEventId: stored?.toSnapshot().deliveryEventId ?? '',
        tokenHash,
        now: bed.clock.now(),
      });

      const preview = await eva.post('/invitations/lookup', { token });
      const wrongAccount = await eva.post('/invitations/accept', { token });
      const accepted = await bia.post('/invitations/accept', { token });
      const reused = await bia.post('/invitations/accept', { token });

      expect(invitationPreviewSchema.parse(preview.body)).toMatchObject({
        organizationName: 'Org acme',
        maskedEmail: 'b***@exemplo.com',
        isForCurrentUser: false,
      });
      expect([wrongAccount.status, problem(wrongAccount).code]).toEqual([
        403,
        'INVITATION_FOR_ANOTHER_ACCOUNT',
      ]);
      expect(accepted.body).toEqual({
        id: acme,
        name: 'Org acme',
        slug: 'acme',
        role: 'admin',
        capabilities: [
          'organization:read',
          'organization:update',
          'member:invite',
          'member:change-role',
          'member:remove',
          'project:create',
        ],
      });
      expect([reused.status, problem(reused).code]).toEqual([400, 'INVALID_OR_EXPIRED_INVITATION']);
    });
  });
});

/** Rotas declaradas num router (método + caminho), lidas da pilha do Express. */
function routeTable(router: Router): string[] {
  return router.stack.flatMap((layer) =>
    layer.route
      ? [...new Set(layer.route.stack.map((handler) => handler.method))].map(
          (method) => `${method.toUpperCase()} ${layer.route?.path ?? ''}`,
        )
      : [],
  );
}

describe('invitation token endpoints limits', () => {
  it.each([
    ['/invitations/lookup', ORGANIZATIONS_RATE_LIMITS.invitationLookupByUser.points],
    ['/invitations/accept', ORGANIZATIONS_RATE_LIMITS.invitationAcceptByUser.points],
  ])('%s answers 429 past %i attempts per user', async (path, points) => {
    const { eva } = setup();
    for (let attempt = 0; attempt < points; attempt += 1) {
      await eva.post(path, { token: 'token-que-nao-existe-0001' });
    }

    const response = await eva.post(path, { token: 'token-que-nao-existe-0001' });

    expect([response.status, problem(response).code]).toEqual([429, 'RATE_LIMITED']);
    expect(response.headers['retry-after']).toBe('3600');
  });
});

describe('route table (ADR 0012)', () => {
  const { routers } = buildApp(createOrganizationsTestbed());

  it('keeps only the non-tenant routes outside the prefix', () => {
    expect(routeTable(routers.router).sort()).toEqual([
      'GET /me/organizations',
      'POST /invitations/accept',
      'POST /invitations/lookup',
      'POST /organizations',
    ]);
  });

  const tenantRoutes = routeTable(routers.tenantRouter);

  it('declares every tenant route relative to the prefix', () => {
    expect(tenantRoutes.sort()).toEqual([
      'DELETE /invitations/:invitationId',
      'DELETE /members/:userId',
      'GET /',
      'GET /invitations',
      'GET /members',
      'PATCH /',
      'PATCH /members/:userId',
      'POST /invitations',
      'POST /invitations/:invitationId/resend',
    ]);
  });

  it.each(tenantRoutes)(
    '%s: 401 without a session, 404 without membership (RNF-01)',
    async (route) => {
      const { app, eva } = setup();
      const [method = 'GET', path = '/'] = route.split(' ');
      const concrete = `/organizations/${UNKNOWN_ORG}${path === '/' ? '' : path}`
        .replace(':userId', ANA)
        .replace(':invitationId', ANA);
      const calls = {
        GET: {
          anonymous: () => request(app).get(`/api/v1${concrete}`),
          outsider: () => eva.get(concrete),
        },
        POST: {
          anonymous: () => request(app).post(`/api/v1${concrete}`),
          outsider: () => eva.post(concrete, {}),
        },
        PATCH: {
          anonymous: () => request(app).patch(`/api/v1${concrete}`),
          outsider: () => eva.patch(concrete, {}),
        },
        DELETE: {
          anonymous: () => request(app).delete(`/api/v1${concrete}`),
          outsider: () => eva.delete(concrete),
        },
      }[method];
      if (!calls) throw new Error(`unexpected method ${method}`);

      const anonymous = await calls.anonymous();
      const outsider = await calls.outsider();

      expect(anonymous.status).toBe(401);
      expect([outsider.status, problem(outsider).code]).toEqual([404, 'ORGANIZATION_NOT_FOUND']);
    },
  );
});
