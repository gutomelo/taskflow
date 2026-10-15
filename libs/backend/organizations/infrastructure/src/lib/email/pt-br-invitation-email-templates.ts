import type { InvitationEmailTemplates } from '@taskflow/backend/organizations/application';
import type { InvitableRole } from '@taskflow/backend/organizations/domain';
import { renderEmail } from '@taskflow/backend/shared/infrastructure';

const ROLE_LABELS: Readonly<Record<InvitableRole, string>> = {
  admin: 'administrador(a)',
  member: 'membro',
  viewer: 'leitor(a)',
};

/**
 * Convite em pt-BR (RNF-08, design "Conteúdo do e-mail"). Nomes vêm validados como texto
 * exibível (sem controles, CR/LF, bidi, zero-width) e aparecem só entre aspas numa frase fixa; o
 * único link é o do TaskFlow; o assunto leva apenas o nome da organização entre aspas.
 */
export const ptBrInvitationEmailTemplates: InvitationEmailTemplates = {
  invitation: ({ to, organizationName, inviterName, role, link, validForDays }) => {
    const who = inviterName ? `“${inviterName}” convidou você` : 'Você foi convidado(a)';
    return renderEmail(
      { email: to, name: null },
      `Convite para a organização “${organizationName}” no TaskFlow`,
      [
        {
          kind: 'paragraph',
          text: `${who} para a organização “${organizationName}” no TaskFlow, com o papel de ${ROLE_LABELS[role]}.`,
        },
        { kind: 'action', label: 'Ver convite', href: link },
        {
          kind: 'paragraph',
          text: `O convite vale por ${validForDays} dias, só pode ser usado uma vez e só funciona na conta com este endereço de e-mail.`,
        },
        { kind: 'paragraph', text: 'Se você não esperava este convite, ignore este e-mail.' },
      ],
    );
  },
};
