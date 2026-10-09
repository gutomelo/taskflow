import type { EmailMessage } from '@taskflow/backend/shared/application';
import type { EmailAddress } from '@taskflow/backend/shared/kernel';

/**
 * Destinatário de um e-mail de identidade. `name` é `null` quando a conta não está verificada:
 * o nome pode ter sido escolhido por quem cadastrou o endereço de outra pessoa, então não entra
 * no e-mail (saudação genérica).
 */
export type IdentityEmailRecipient = Readonly<{ email: EmailAddress; name: string | null }>;

/** Porta: textos dos e-mails de identidade (pt-BR na infraestrutura), com HTML escapado. */
export interface IdentityEmailTemplates {
  emailVerification(input: {
    readonly recipient: IdentityEmailRecipient;
    readonly link: string;
    readonly validForHours: number;
  }): EmailMessage;
  passwordReset(input: {
    readonly recipient: IdentityEmailRecipient;
    readonly link: string;
    readonly validForMinutes: number;
  }): EmailMessage;
  /** BR-014: alguém tentou cadastrar o endereço; nenhum link de verificação é enviado. */
  accountAlreadyExists(input: {
    readonly recipient: IdentityEmailRecipient;
    readonly loginLink: string;
    readonly forgotPasswordLink: string;
  }): EmailMessage;
  passwordChanged(input: {
    readonly recipient: IdentityEmailRecipient;
    readonly forgotPasswordLink: string;
  }): EmailMessage;
}
