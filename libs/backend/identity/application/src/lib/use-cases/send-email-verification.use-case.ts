import type { EmailSender } from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
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

export interface SendEmailVerificationCommand {
  /** Evento da outbox: chave do token (um token por evento, mesmo com retries). */
  readonly eventId: string;
  readonly userId: string;
}

export interface SendEmailVerificationDependencies {
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
 * Worker, evento `identity.email_verification_requested` (RF-02, ADR 0011). Cada tentativa emite
 * um token novo para o evento e só então envia: se o envio falhar, o retry substitui o token e
 * vale o link da última tentativa. Falha de envio propaga para o retry da fila.
 */
export class SendEmailVerificationUseCase {
  constructor(private readonly deps: SendEmailVerificationDependencies) {}

  async execute({ eventId, userId }: SendEmailVerificationCommand): Promise<EmailDeliveryOutcome> {
    const user = await this.deps.users.findById(userId);
    if (!user) return discarded('user_not_found');
    if (user.isEmailVerified) return discarded('email_already_verified');

    const secret = this.deps.secretTokens.generate();
    const issued = await this.deps.userTokens.upsertForEvent(
      UserToken.issue({
        id: this.deps.idGenerator.generate(),
        userId: user.id,
        purpose: 'email_verification',
        tokenHash: secret.tokenHash,
        sourceEventId: eventId,
        now: this.deps.clock.now(),
      }),
    );
    if (issued === 'already_consumed') return discarded('token_already_used');

    await this.deps.emailSender.send(
      this.deps.templates.emailVerification({
        recipient: recipientOf(user),
        link: tokenLink(this.deps.appUrl, '/verify-email', secret.token),
        validForHours: USER_TOKEN_TTL_MS.email_verification / 3_600_000,
      }),
    );
    return SENT;
  }
}
