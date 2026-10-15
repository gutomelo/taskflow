import type { EmailSender } from '@taskflow/backend/shared/application';
import type { Clock } from '@taskflow/backend/shared/kernel';
import {
  INVITATION_TTL_MS,
  type InvitationRepository,
  type OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import type { InvitationEmailTemplates } from '../ports/invitation-email-templates';
import type { InvitationTokenGenerator } from '../ports/invitation-token-generator';
import type { UserDirectory } from '../ports/user-directory';

/** Resultado do envio, para log do worker (nunca contém e-mail nem token). */
export type InvitationDeliveryOutcome =
  | Readonly<{ status: 'sent' }>
  | Readonly<{
      status: 'discarded';
      reason: 'invitation_not_found' | 'invitation_closed' | 'superseded';
    }>;

export interface SendInvitationDependencies {
  readonly invitations: InvitationRepository;
  readonly organizations: OrganizationRepository;
  readonly users: UserDirectory;
  readonly tokens: InvitationTokenGenerator;
  readonly emailSender: EmailSender;
  readonly templates: InvitationEmailTemplates;
  readonly clock: Clock;
  readonly appUrl: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Worker, evento `organizations.invitation_requested` (BR-020, ADR 0011). O token nasce aqui e só
 * é gravado se o evento ainda for o último envio de um convite aberto e não expirado: eventos
 * antigos fora de ordem são descartados, e o link vigente é sempre o do último envio. Retry do
 * mesmo evento troca o token antes de reenviar. Falha de SMTP propaga para o retry da fila.
 */
export class SendInvitationUseCase {
  constructor(private readonly deps: SendInvitationDependencies) {}

  async execute(input: {
    readonly eventId: string;
    readonly invitationId: string;
  }): Promise<InvitationDeliveryOutcome> {
    const invitation = await this.deps.invitations.findForDelivery(input.invitationId);
    if (!invitation) return { status: 'discarded', reason: 'invitation_not_found' };
    const now = this.deps.clock.now();
    if (!invitation.isOpen || invitation.isExpired(now)) {
      return { status: 'discarded', reason: 'invitation_closed' };
    }
    const { organizationId, email, role, invitedByUserId, deliveryEventId } =
      invitation.toSnapshot();
    if (deliveryEventId !== input.eventId) return { status: 'discarded', reason: 'superseded' };

    const secret = this.deps.tokens.generate();
    const issued = await this.deps.invitations.issueToken({
      invitationId: invitation.id,
      deliveryEventId: input.eventId,
      tokenHash: secret.tokenHash,
      now,
    });
    // Reenviado, revogado ou aceito entre a leitura e a emissão.
    if (!issued) return { status: 'discarded', reason: 'superseded' };

    const organization = await this.deps.organizations.findById(organizationId);
    if (!organization) return { status: 'discarded', reason: 'invitation_not_found' };
    const inviter = (await this.deps.users.getAccounts([invitedByUserId])).get(invitedByUserId);

    await this.deps.emailSender.send(
      this.deps.templates.invitation({
        to: email,
        organizationName: organization.toSnapshot().name.value,
        inviterName: inviter?.name ?? null,
        role,
        // Token no fragmento: não chega ao servidor, a logs de proxy nem ao `Referer`.
        link: `${new URL('/invitations/accept', this.deps.appUrl).toString()}#token=${encodeURIComponent(secret.token)}`,
        validForDays: INVITATION_TTL_MS / DAY_MS,
      }),
    );
    return { status: 'sent' };
  }
}
