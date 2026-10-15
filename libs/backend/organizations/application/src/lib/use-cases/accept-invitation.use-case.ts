import type { RequestContext, TransactionRunner } from '@taskflow/backend/shared/application';
import { EmailAddress, type Clock, type IdGenerator } from '@taskflow/backend/shared/kernel';
import {
  AlreadyAMemberError,
  canInvite,
  Membership,
  type InvitationRepository,
  type MembershipRepository,
  type OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import type { InvitationTokenGenerator } from '../ports/invitation-token-generator';
import type { UserDirectory } from '../ports/user-directory';
import { MAX_MEMBERSHIPS_PER_USER } from '../shared/organization-limits';
import { toMyOrganizationView, type MyOrganizationView } from '../shared/organization-views';
import {
  EmailNotVerifiedError,
  InvalidOrExpiredInvitationError,
  InvitationForAnotherAccountError,
  OrganizationLimitReachedError,
} from '../shared/organizations-errors';
import type { OrganizationsSecurityEventRecorder } from '../shared/organizations-security-events';

export interface AcceptInvitationDependencies {
  readonly organizations: OrganizationRepository;
  readonly memberships: MembershipRepository;
  readonly invitations: InvitationRepository;
  readonly users: UserDirectory;
  readonly tokens: InvitationTokenGenerator;
  readonly transactions: TransactionRunner;
  readonly securityEvents: OrganizationsSecurityEventRecorder;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * RF-08 (BR-013, BR-020, BR-021). Ordem: `EMAIL_NOT_VERIFIED` → conta errada (403, sem consumir)
 * → inválido. Sob o lock da organização: revalida o convidante, aplica os limites e consome o
 * convite condicionado ao e-mail da conta no mesmo `UPDATE`, junto com a membership.
 */
export class AcceptInvitationUseCase {
  constructor(private readonly deps: AcceptInvitationDependencies) {}

  async execute(
    context: RequestContext,
    command: { readonly token: string },
  ): Promise<MyOrganizationView> {
    const userId = context.actor.userId;
    const account = (await this.deps.users.getAccounts([userId])).get(userId);
    if (!account?.emailVerified) throw new EmailNotVerifiedError();
    const email = EmailAddress.create(account.email);

    const tokenHash = this.deps.tokens.hash(command.token);
    const found = await this.deps.invitations.findUsableByTokenHash(
      tokenHash,
      this.deps.clock.now(),
    );
    if (!found) throw new InvalidOrExpiredInvitationError();
    const { organizationId, email: invitedEmail } = found.toSnapshot();
    if (invitedEmail.value !== email.value) throw new InvitationForAnotherAccountError();

    const outcome = await this.deps.transactions.run(async () => {
      if (!(await this.deps.organizations.lockForMembershipChange(organizationId))) {
        throw new InvalidOrExpiredInvitationError();
      }
      // Relido sob o lock: um convite revogado ou reenviado no meio já não casa com o token.
      const invitation = await this.deps.invitations.findUsableByTokenHash(
        tokenHash,
        this.deps.clock.now(),
      );
      if (!invitation) throw new InvalidOrExpiredInvitationError();
      const { invitedByUserId, role } = invitation.toSnapshot();
      // O convidante precisa continuar podendo conceder este papel (removido/rebaixado ⇒ inválido).
      const inviter = await this.deps.memberships.find(organizationId, invitedByUserId);
      if (!inviter || !canInvite(inviter.role, role)) throw new InvalidOrExpiredInvitationError();
      if (await this.deps.memberships.find(organizationId, userId)) throw new AlreadyAMemberError();
      if ((await this.deps.memberships.countForUser(userId)) >= MAX_MEMBERSHIPS_PER_USER) {
        throw new OrganizationLimitReachedError('memberships');
      }

      const now = this.deps.clock.now();
      const consumed = await this.deps.invitations.consume({
        tokenHash,
        email,
        acceptedByUserId: userId,
        now,
      });
      if (!consumed) throw new InvalidOrExpiredInvitationError();
      await this.deps.memberships.add(
        Membership.create({
          id: this.deps.idGenerator.generate(),
          organizationId,
          userId,
          role,
          now,
        }),
      );
      const organization = await this.deps.organizations.findById(organizationId);
      if (!organization) throw new InvalidOrExpiredInvitationError();
      return { invitationId: consumed.id, role, organization };
    });

    this.deps.securityEvents.record({
      type: 'organizations.invitation_accepted',
      requestId: context.requestId,
      organizationId,
      actorUserId: userId,
      invitationId: outcome.invitationId,
      role: outcome.role,
    });
    return toMyOrganizationView(outcome.organization, outcome.role);
  }
}
