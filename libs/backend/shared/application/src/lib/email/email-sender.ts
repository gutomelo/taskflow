import type { EmailAddress } from '@taskflow/backend/shared/kernel';

export type EmailMessage = Readonly<{
  to: EmailAddress;
  subject: string;
  /** Versão em texto puro, obrigatória para acessibilidade e clientes sem HTML. */
  text: string;
  /** HTML já escapado pelo template; nunca concatene dados do usuário sem escape. */
  html: string;
}>;

/** Transporte de e-mail (SMTP na infraestrutura). Lança erro em falha para permitir retry. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
