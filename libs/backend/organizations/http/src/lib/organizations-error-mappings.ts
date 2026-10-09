import type { DomainErrorMapping } from '@taskflow/backend/shared/http';

/**
 * Tradução dos códigos de `organizations` para HTTP (design da spec 002, tabelas de endpoints).
 * Títulos em pt-BR seguros para exibição. Inexistente e de outra organização respondem igual (404).
 */
export const organizationsErrorMappings: Readonly<Record<string, DomainErrorMapping>> = {
  INVALID_ORGANIZATION_NAME: { status: 400, title: 'Nome da organização inválido' },
  INVALID_SLUG: { status: 400, title: 'Endereço da organização inválido' },
  SLUG_TAKEN: { status: 409, title: 'Este endereço já está em uso' },
  EMAIL_NOT_VERIFIED: { status: 403, title: 'Confirme seu e-mail para continuar' },
  ORGANIZATION_LIMIT_REACHED: { status: 422, title: 'Limite de organizações atingido' },
  ORGANIZATION_NOT_FOUND: { status: 404, title: 'Organização não encontrada' },
  INSUFFICIENT_ROLE: { status: 403, title: 'Seu papel não permite esta ação' },
  MEMBER_NOT_FOUND: { status: 404, title: 'Membro não encontrado' },
  ROLE_CHANGE_NOT_ALLOWED: { status: 403, title: 'Você não pode fazer esta alteração de papel' },
  LAST_OWNER: { status: 409, title: 'A organização precisa de pelo menos um proprietário' },
  ALREADY_A_MEMBER: { status: 409, title: 'Esta pessoa já é membro da organização' },
  INVALID_INVITATION_ROLE: { status: 400, title: 'Papel inválido para convite' },
  // Defesa: os caminhos que criam convite travam a organização e não chegam a disparar o único.
  INVITATION_ALREADY_OPEN: { status: 409, title: 'Já existe um convite aberto para este e-mail' },
  INVITATION_NOT_FOUND: { status: 404, title: 'Convite não encontrado' },
  INVALID_OR_EXPIRED_INVITATION: { status: 400, title: 'Convite inválido ou expirado' },
  INVITATION_FOR_ANOTHER_ACCOUNT: {
    status: 403,
    title: 'Este convite é para outra conta. Entre com o e-mail convidado para aceitar.',
  },
  VERSION_CONFLICT: {
    status: 409,
    title: 'Os dados foram alterados por outra operação. Tente novamente.',
  },
};
