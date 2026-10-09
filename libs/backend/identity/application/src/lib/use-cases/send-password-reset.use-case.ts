import type { EmailSender } from '@taskflow/backend/shared/application';
import {
  EmailAddress,
  InvalidEmailAddressError,
  type Clock,
  type IdGenerator,
} from '@taskflow/backend/shared/kernel';
import {
  USER_TOKEN_TTL_MS,
  UserToken,
  type SecretTokenGenerator,
  type UserRepository,
  type UserTokenRepository,
} from '@taskflow/backend/identity/domain';
import type { IdentityEmailTemplates } from '../ports/identity-email-templates';
import {
  discarded,
  recipientOf,
  SENT,
  tokenLink,
  type EmailDeliveryOutcome,
} from '../shared/identity-email-links';

export interface SendPasswordResetCommand {
  readonly eventId: string;
  /** E-mail informado no pedido (a API não consulta a conta: trabalho constante, BR-014). */
  readonly email: string;
}

export interface SendPasswordResetDependencies {
  readonly users: UserRepository;
  readonly userTokens: UserTokenRepository;
  readonly secretTokens: SecretTokenGenerator;
  readonly emailSender: EmailSender;
  readonly templates: IdentityEmailTemplates;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly appUrl: string;
}

/**
 * Worker, evento `identity.password_reset_requested` (RF-10). Sem conta para o endereço, o
 * evento é descartado em silêncio. Mesma política de token por evento da verificação.
 */
export class SendPasswordResetUseCase {
  constructor(private readonly deps: SendPasswordResetDependencies) {}

  async execute({ eventId, email }: SendPasswordResetCommand): Promise<EmailDeliveryOutcome> {
    const address = parseAddress(email);
    if (!address) return discarded('invalid_email');
    const user = await this.deps.users.findByEmail(address);
    if (!user) return discarded('user_not_found');

    const secret = this.deps.secretTokens.generate();
    const issued = await this.deps.userTokens.upsertForEvent(
      UserToken.issue({
        id: this.deps.idGenerator.generate(),
        userId: user.id,
        purpose: 'password_reset',
        tokenHash: secret.tokenHash,
        sourceEventId: eventId,
        now: this.deps.clock.now(),
      }),
    );
    if (issued === 'already_consumed') return discarded('token_already_used');

    await this.deps.emailSender.send(
      this.deps.templates.passwordReset({
        recipient: recipientOf(user),
        link: tokenLink(this.deps.appUrl, '/reset-password', secret.token),
        validForMinutes: USER_TOKEN_TTL_MS.password_reset / 60_000,
      }),
    );
    return SENT;
  }
}

function parseAddress(raw: string): EmailAddress | null {
  try {
    return EmailAddress.create(raw);
  } catch (error) {
    if (error instanceof InvalidEmailAddressError) return null;
    throw error;
  }
}
