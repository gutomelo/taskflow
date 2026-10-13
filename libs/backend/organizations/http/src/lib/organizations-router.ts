import { Router, type Request, type RequestHandler } from 'express';
import type { RateLimiter, RateLimitPolicy } from '@taskflow/backend/shared/application';
import {
  createRateLimit,
  HttpError,
  noStore,
  parseBody,
  requestContextFrom,
  tenantRequestContextFrom,
  type CsrfProtection,
} from '@taskflow/backend/shared/http';
import type {
  AcceptInvitationUseCase,
  ChangeMemberRoleUseCase,
  CreateOrganizationUseCase,
  GetOrganizationUseCase,
  InvitationView,
  InviteMemberUseCase,
  ListInvitationsUseCase,
  ListMembersUseCase,
  ListMyOrganizationsUseCase,
  LookupInvitationUseCase,
  MemberView,
  MyOrganizationView,
  OrganizationView,
  RemoveMemberUseCase,
  ResendInvitationUseCase,
  RevokeInvitationUseCase,
  UpdateOrganizationUseCase,
} from '@taskflow/backend/organizations/application';
import {
  changeMemberRoleRequestSchema,
  createOrganizationRequestSchema,
  invitationIdParamSchema,
  invitationTokenRequestSchema,
  inviteMemberRequestSchema,
  memberUserIdParamSchema,
  pageQuerySchema,
  removeMemberQuerySchema,
  updateOrganizationRequestSchema,
  type InvitationDto,
  type InvitationPage,
  type InvitationPreview,
  type Member,
  type MemberPage,
  type MyOrganization,
  type MyOrganizationList,
  type OrganizationDto,
} from '@taskflow/contracts';
import type { z } from 'zod';
import { ORGANIZATIONS_RATE_LIMITS, userKey } from './organizations-rate-limits';

type Executes<T extends { execute: (...args: never[]) => unknown }> = Pick<T, 'execute'>;

export interface OrganizationsHttpDependencies {
  readonly useCases: Readonly<{
    createOrganization: Executes<CreateOrganizationUseCase>;
    listMyOrganizations: Executes<ListMyOrganizationsUseCase>;
    getOrganization: Executes<GetOrganizationUseCase>;
    updateOrganization: Executes<UpdateOrganizationUseCase>;
    listMembers: Executes<ListMembersUseCase>;
    changeMemberRole: Executes<ChangeMemberRoleUseCase>;
    removeMember: Executes<RemoveMemberUseCase>;
    listInvitations: Executes<ListInvitationsUseCase>;
    inviteMember: Executes<InviteMemberUseCase>;
    resendInvitation: Executes<ResendInvitationUseCase>;
    revokeInvitation: Executes<RevokeInvitationUseCase>;
    lookupInvitation: Executes<LookupInvitationUseCase>;
    acceptInvitation: Executes<AcceptInvitationUseCase>;
  }>;
  readonly authenticate: RequestHandler;
  readonly csrf: CsrfProtection;
  readonly rateLimiter: RateLimiter;
}

export interface OrganizationsRouters {
  /** Rotas sem organização ativa, montadas em `/api/v1`. */
  readonly router: Router;
  /**
   * Rotas tenant-scoped com caminhos **relativos**: só funcionam montadas pelo composition root
   * sob `/organizations/:organizationId`, depois de `authenticate → csrf → tenantContext`
   * (ADR 0012). `tenantRequestContextFrom` falha fechado se montadas em outro lugar.
   */
  readonly tenantRouter: Router;
}

/** Parâmetro de rota malformado responde como recurso inexistente (sem oráculo, sem 500). */
function parseParams<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  notFound: () => HttpError,
): z.output<TSchema> {
  const result = schema.safeParse(request.params);
  if (!result.success) throw notFound();
  return result.data;
}

function parseQuery<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): z.output<TSchema> {
  const result = schema.safeParse(request.query);
  if (result.success) return result.data;
  throw new HttpError(400, 'VALIDATION_FAILED', 'Dados inválidos', {
    violations: result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(query)',
      message: issue.message,
    })),
  });
}

const memberNotFound = () => new HttpError(404, 'MEMBER_NOT_FOUND', 'Membro não encontrado');
const invitationNotFound = () =>
  new HttpError(404, 'INVITATION_NOT_FOUND', 'Convite não encontrado');

const toOrganizationDto = (view: OrganizationView): OrganizationDto => ({
  ...view,
  createdAt: view.createdAt.toISOString(),
  capabilities: [...view.capabilities],
});
const toMyOrganization = (view: MyOrganizationView): MyOrganization => ({
  ...view,
  capabilities: [...view.capabilities],
});
const toMember = (view: MemberView): Member => ({
  ...view,
  joinedAt: view.joinedAt.toISOString(),
  actions: { changeRoleTo: [...view.actions.changeRoleTo], remove: view.actions.remove },
});
const toInvitation = (view: InvitationView): InvitationDto => ({
  ...view,
  invitedBy: { ...view.invitedBy },
  expiresAt: view.expiresAt.toISOString(),
  createdAt: view.createdAt.toISOString(),
});

/**
 * Rotas de Organizations (spec 002). Controllers finos: validam o contrato, chamam um caso de
 * uso e mapeiam explicitamente para o contrato. Erros seguem para o error handler.
 */
export function createOrganizationsRouters(
  deps: OrganizationsHttpDependencies,
): OrganizationsRouters {
  const { useCases, authenticate, csrf } = deps;
  const limit = (policy: RateLimitPolicy) =>
    createRateLimit({ limiter: deps.rateLimiter, policy, key: userKey });

  // Sem `router.use`: este router é montado em `/api/v1` junto com os demais e não pode exigir
  // sessão de rotas alheias.
  const router = Router();

  router.post(
    '/organizations',
    noStore,
    authenticate,
    csrf.require(),
    async (request, response) => {
      const view = await useCases.createOrganization.execute(
        requestContextFrom(request),
        parseBody(request, createOrganizationRequestSchema),
      );
      response
        .status(201)
        .location(`/api/v1/organizations/${view.id}`)
        .json(toOrganizationDto(view) satisfies OrganizationDto);
    },
  );

  router.get('/me/organizations', noStore, authenticate, async (request, response) => {
    const items = await useCases.listMyOrganizations.execute(requestContextFrom(request));
    response.json({ items: items.map(toMyOrganization) } satisfies MyOrganizationList);
  });

  router.post(
    '/invitations/lookup',
    noStore,
    authenticate,
    csrf.require(),
    limit(ORGANIZATIONS_RATE_LIMITS.invitationLookupByUser),
    async (request, response) => {
      const preview = await useCases.lookupInvitation.execute(
        requestContextFrom(request),
        parseBody(request, invitationTokenRequestSchema),
      );
      response.json({
        ...preview,
        expiresAt: preview.expiresAt.toISOString(),
      } satisfies InvitationPreview);
    },
  );

  router.post(
    '/invitations/accept',
    noStore,
    authenticate,
    csrf.require(),
    limit(ORGANIZATIONS_RATE_LIMITS.invitationAcceptByUser),
    async (request, response) => {
      const view = await useCases.acceptInvitation.execute(
        requestContextFrom(request),
        parseBody(request, invitationTokenRequestSchema),
      );
      response.json(toMyOrganization(view) satisfies MyOrganization);
    },
  );

  const tenantRouter = Router({ mergeParams: true });
  tenantRouter.use(noStore);

  tenantRouter.get('/', async (request, response) => {
    const view = await useCases.getOrganization.execute(tenantRequestContextFrom(request));
    response.json(toOrganizationDto(view) satisfies OrganizationDto);
  });

  tenantRouter.patch('/', async (request, response) => {
    const view = await useCases.updateOrganization.execute(
      tenantRequestContextFrom(request),
      parseBody(request, updateOrganizationRequestSchema),
    );
    response.json(toOrganizationDto(view) satisfies OrganizationDto);
  });

  tenantRouter.get('/members', async (request, response) => {
    const page = await useCases.listMembers.execute(
      tenantRequestContextFrom(request),
      parseQuery(request, pageQuerySchema),
    );
    response.json({
      items: page.items.map(toMember),
      nextCursor: page.nextCursor,
    } satisfies MemberPage);
  });

  tenantRouter.patch('/members/:userId', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { userId } = parseParams(request, memberUserIdParamSchema, memberNotFound);
    const { role, version } = parseBody(request, changeMemberRoleRequestSchema);
    const view = await useCases.changeMemberRole.execute(context, { userId, role, version });
    response.json(toMember(view) satisfies Member);
  });

  tenantRouter.delete('/members/:userId', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { userId } = parseParams(request, memberUserIdParamSchema, memberNotFound);
    const { version } = parseQuery(request, removeMemberQuerySchema);
    await useCases.removeMember.execute(context, { userId, version });
    response.status(204).end();
  });

  tenantRouter.get('/invitations', async (request, response) => {
    const page = await useCases.listInvitations.execute(
      tenantRequestContextFrom(request),
      parseQuery(request, pageQuerySchema),
    );
    response.json({
      items: page.items.map(toInvitation),
      nextCursor: page.nextCursor,
    } satisfies InvitationPage);
  });

  tenantRouter.post('/invitations', async (request, response) => {
    const result = await useCases.inviteMember.execute(
      tenantRequestContextFrom(request),
      parseBody(request, inviteMemberRequestSchema),
    );
    response
      .status(result.created ? 201 : 200)
      .json(toInvitation(result.invitation) satisfies InvitationDto);
  });

  tenantRouter.post('/invitations/:invitationId/resend', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { invitationId } = parseParams(request, invitationIdParamSchema, invitationNotFound);
    await useCases.resendInvitation.execute(context, invitationId);
    response.status(202).end();
  });

  tenantRouter.delete('/invitations/:invitationId', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { invitationId } = parseParams(request, invitationIdParamSchema, invitationNotFound);
    await useCases.revokeInvitation.execute(context, invitationId);
    response.status(204).end();
  });

  return { router, tenantRouter };
}
