import {
  RateLimitedError,
  type RateLimiter,
  type RequestContext,
  type TransactionRunner,
} from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import {
  Membership,
  Organization,
  OrganizationName,
  OrganizationSlug,
  type MembershipRepository,
  type OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import type { UserDirectory } from '../ports/user-directory';
import {
  MAX_MEMBERSHIPS_PER_USER,
  MAX_OWNED_ORGANIZATIONS,
  ORGANIZATION_CREATION_POLICY,
} from '../shared/organization-limits';
import { toOrganizationView, type OrganizationView } from '../shared/organization-views';
import {
  EmailNotVerifiedError,
  OrganizationLimitReachedError,
} from '../shared/organizations-errors';
import type { OrganizationsSecurityEventRecorder } from '../shared/organizations-security-events';

export type CreateOrganizationCommand = Readonly<{ name: string; slug: string }>;

export interface CreateOrganizationDependencies {
  readonly organizations: OrganizationRepository;
  readonly memberships: MembershipRepository;
  readonly users: UserDirectory;
  readonly rateLimiter: RateLimiter;
  readonly transactions: TransactionRunner;
  readonly securityEvents: OrganizationsSecurityEventRecorder;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** RF-01: cria a organização com o ator como `owner` (BR-013, BR-022, RNF-04). */
export class CreateOrganizationUseCase {
  constructor(private readonly deps: CreateOrganizationDependencies) {}

  async execute(
    context: RequestContext,
    command: CreateOrganizationCommand,
  ): Promise<OrganizationView> {
    const { userId } = context.actor;
    // Conta a tentativa antes de qualquer validação: slugs recusados também consomem o limite.
    const decision = await this.deps.rateLimiter.consume(ORGANIZATION_CREATION_POLICY, userId);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);

    const account = (await this.deps.users.getAccounts([userId])).get(userId);
    if (!account?.emailVerified) throw new EmailNotVerifiedError();

    const name = OrganizationName.create(command.name);
    const slug = OrganizationSlug.create(command.slug);

    const organization = await this.deps.transactions.run(async () => {
      // Tetos lidos sem lock por usuário: duas criações simultâneas podem passar de 20/100 por
      // uma unidade; o limite de 5 criações por dia mantém o excesso pequeno (RNF-04).
      if ((await this.deps.memberships.countOwnedBy(userId)) >= MAX_OWNED_ORGANIZATIONS) {
        throw new OrganizationLimitReachedError('owned_organizations');
      }
      if ((await this.deps.memberships.countForUser(userId)) >= MAX_MEMBERSHIPS_PER_USER) {
        throw new OrganizationLimitReachedError('memberships');
      }
      const now = this.deps.clock.now();
      const created = Organization.create({
        id: this.deps.idGenerator.generate(),
        name,
        slug,
        now,
      });
      await this.deps.organizations.add(created); // SlugTakenError (409) inclusive por corrida
      await this.deps.memberships.add(
        Membership.create({
          id: this.deps.idGenerator.generate(),
          organizationId: created.id,
          userId,
          role: 'owner',
          now,
        }),
      );
      return created;
    });

    this.deps.securityEvents.record({
      type: 'organizations.created',
      requestId: context.requestId,
      organizationId: organization.id,
      actorUserId: userId,
    });
    return toOrganizationView(organization, 'owner');
  }
}
