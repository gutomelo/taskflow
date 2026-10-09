import type { RequestContext } from '@taskflow/backend/shared/application';
import type { Clock } from '@taskflow/backend/shared/kernel';
import type {
  InvitableRole,
  InvitationRepository,
  OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import type { InvitationTokenGenerator } from '../ports/invitation-token-generator';
import type { UserDirectory } from '../ports/user-directory';
import { maskEmail } from '../shared/mask-email';
import { InvalidOrExpiredInvitationError } from '../shared/organizations-errors';

/** Prévia do convite para a tela de aceite (nome da organização e do convidante entre aspas). */
export type InvitationPreview = Readonly<{
  organizationName: string;
  role: InvitableRole;
  invitedByName: string | null;
  maskedEmail: string;
  isForCurrentUser: boolean;
  expiresAt: Date;
}>;

/**
 * RF-08: qualquer conta autenticada consulta um token — inclusive ainda não verificada, para a
 * tela orientar. E-mail mascarado; nada é consumido.
 */
export class LookupInvitationUseCase {
  constructor(
    private readonly deps: {
      readonly invitations: InvitationRepository;
      readonly organizations: OrganizationRepository;
      readonly users: UserDirectory;
      readonly tokens: InvitationTokenGenerator;
      readonly clock: Clock;
    },
  ) {}

  async execute(
    context: RequestContext,
    command: { readonly token: string },
  ): Promise<InvitationPreview> {
    const invitation = await this.deps.invitations.findUsableByTokenHash(
      this.deps.tokens.hash(command.token),
      this.deps.clock.now(),
    );
    if (!invitation) throw new InvalidOrExpiredInvitationError();
    const { organizationId, email, role, invitedByUserId, expiresAt } = invitation.toSnapshot();
    const organization = await this.deps.organizations.findById(organizationId);
    if (!organization) throw new InvalidOrExpiredInvitationError();

    const actorUserId = context.actor.userId;
    const accounts = await this.deps.users.getAccounts([actorUserId, invitedByUserId]);
    return {
      organizationName: organization.toSnapshot().name.value,
      role,
      invitedByName: accounts.get(invitedByUserId)?.name ?? null,
      maskedEmail: maskEmail(email.value),
      isForCurrentUser: accounts.get(actorUserId)?.email === email.value,
      expiresAt,
    };
  }
}
