import type { EmailSender } from '@taskflow/backend/shared/application';
import type { UserRepository } from '@taskflow/backend/identity/domain';
import type { IdentityEmailTemplates } from '../ports/identity-email-templates';
import {
  appLink,
  discarded,
  recipientOf,
  SENT,
  type EmailDeliveryOutcome,
} from '../shared/identity-email-links';

export type AccountNotice = 'account_already_exists' | 'password_changed';

export interface SendAccountNoticeCommand {
  readonly userId: string;
  readonly notice: AccountNotice;
}

export interface SendAccountNoticeDependencies {
  readonly users: UserRepository;
  readonly emailSender: EmailSender;
  readonly templates: IdentityEmailTemplates;
  readonly appUrl: string;
}

/**
 * Worker, avisos sem token (BR-014 e BR-016). Não há estado a proteger, então um retry após
 * envio bem-sucedido pode duplicar o aviso — aceito pelo design (entrega pelo menos uma vez).
 */
export class SendAccountNoticeUseCase {
  constructor(private readonly deps: SendAccountNoticeDependencies) {}

  async execute({ userId, notice }: SendAccountNoticeCommand): Promise<EmailDeliveryOutcome> {
    const user = await this.deps.users.findById(userId);
    if (!user) return discarded('user_not_found');

    const recipient = recipientOf(user);
    const forgotPasswordLink = appLink(this.deps.appUrl, '/forgot-password');
    await this.deps.emailSender.send(
      notice === 'account_already_exists'
        ? this.deps.templates.accountAlreadyExists({
            recipient,
            loginLink: appLink(this.deps.appUrl, '/login'),
            forgotPasswordLink,
          })
        : this.deps.templates.passwordChanged({ recipient, forgotPasswordLink }),
    );
    return SENT;
  }
}
