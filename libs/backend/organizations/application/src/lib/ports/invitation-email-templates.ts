import type { EmailMessage } from '@taskflow/backend/shared/application';
import type { EmailAddress } from '@taskflow/backend/shared/kernel';
import type { InvitableRole } from '@taskflow/backend/organizations/domain';

/**
 * Porta: texto do e-mail de convite (pt-BR na infraestrutura). RNF-08: nome da organização e do
 * convidante (texto exibível já validado) entre aspas numa frase fixa, aviso "se não esperava,
 * ignore", nenhum texto livre como link; HTML escapado.
 */
export interface InvitationEmailTemplates {
  invitation(input: {
    readonly to: EmailAddress;
    readonly organizationName: string;
    /** `null` se a conta do convidante sumiu: frase sem nome. */
    readonly inviterName: string | null;
    readonly role: InvitableRole;
    readonly link: string;
    readonly validForDays: number;
  }): EmailMessage;
}
