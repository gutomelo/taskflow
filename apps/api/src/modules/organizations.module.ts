import type { RequestHandler, Router } from 'express';
import type { Logger } from 'pino';
import type {
  OutboxWriter,
  Pseudonymizer,
  RateLimiter,
  TransactionRunner,
} from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import type {
  CsrfProtection,
  DomainErrorMapping,
  TenantContextOptions,
} from '@taskflow/backend/shared/http';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';
import { CryptoSecretTokenGenerator } from '@taskflow/backend/identity/infrastructure';
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
  type OrganizationsSecurityEventRecorder,
  type UserDirectory,
} from '@taskflow/backend/organizations/application';
import {
  PrismaInvitationRepository,
  PrismaMembershipRepository,
  PrismaOrganizationRepository,
} from '@taskflow/backend/organizations/infrastructure';
import {
  createOrganizationsRouters,
  organizationsErrorMappings,
} from '@taskflow/backend/organizations/http';

export interface OrganizationsModuleDependencies {
  readonly logger: Logger;
  readonly transactions: PrismaTransactionRunner & TransactionRunner;
  readonly outbox: OutboxWriter;
  readonly rateLimiter: RateLimiter;
  readonly pseudonymizer: Pseudonymizer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Contas de `identity` (adaptador do composition root). */
  readonly users: UserDirectory;
  readonly authenticate: RequestHandler;
  readonly csrf: CsrfProtection;
}

export interface OrganizationsModule {
  /** Rotas sem organização ativa (`/organizations`, `/me/organizations`, `/invitations/*`). */
  readonly router: Router;
  /** Rotas tenant-scoped, montadas pelo composition root no `createTenantScope`. */
  readonly tenantRouter: Router;
  /** Resolvedor do middleware de tenant (ADR 0012). */
  readonly resolveTenant: TenantContextOptions['resolve'];
  readonly domainErrors: Readonly<Record<string, DomainErrorMapping>>;
}

/** Composition root do contexto Organizations (spec 002). */
export function createOrganizationsModule(
  deps: OrganizationsModuleDependencies,
): OrganizationsModule {
  const { logger, transactions } = deps;
  const organizations = new PrismaOrganizationRepository(transactions);
  const memberships = new PrismaMembershipRepository(transactions);
  const invitations = new PrismaInvitationRepository(transactions);
  // RF-13: eventos de segurança no log estruturado, só com ids (e-mail nunca em claro).
  const securityEvents: OrganizationsSecurityEventRecorder = {
    record: (event) => logger.warn({ securityEvent: event }, event.type),
  };
  const shared = {
    organizations,
    memberships,
    invitations,
    transactions,
    users: deps.users,
    outbox: deps.outbox,
    rateLimiter: deps.rateLimiter,
    pseudonymizer: deps.pseudonymizer,
    securityEvents,
    // Mesmo gerador criptográfico de `identity` (256 bits, SHA-256), compatível com a porta.
    tokens: new CryptoSecretTokenGenerator(),
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };
  const resolveMembership = new ResolveTenantMembershipUseCase({ memberships });

  const { router, tenantRouter } = createOrganizationsRouters({
    useCases: {
      createOrganization: new CreateOrganizationUseCase(shared),
      listMyOrganizations: new ListMyOrganizationsUseCase(shared),
      getOrganization: new GetOrganizationUseCase(shared),
      updateOrganization: new UpdateOrganizationUseCase(shared),
      listMembers: new ListMembersUseCase(shared),
      changeMemberRole: new ChangeMemberRoleUseCase(shared),
      removeMember: new RemoveMemberUseCase(shared),
      listInvitations: new ListInvitationsUseCase(shared),
      inviteMember: new InviteMemberUseCase(shared),
      resendInvitation: new ResendInvitationUseCase(shared),
      revokeInvitation: new RevokeInvitationUseCase(shared),
      lookupInvitation: new LookupInvitationUseCase(shared),
      acceptInvitation: new AcceptInvitationUseCase(shared),
    },
    authenticate: deps.authenticate,
    csrf: deps.csrf,
    rateLimiter: deps.rateLimiter,
  });

  return {
    router,
    tenantRouter,
    resolveTenant: (input) => resolveMembership.execute(input),
    domainErrors: organizationsErrorMappings,
  };
}
