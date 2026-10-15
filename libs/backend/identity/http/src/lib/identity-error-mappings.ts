import type { DomainErrorMapping } from '@taskflow/backend/shared/http';
import { PasswordPolicyViolationError } from '@taskflow/backend/identity/domain';

/**
 * Tradução dos códigos de erro de identidade para HTTP (design da spec 001). Títulos em pt-BR
 * seguros para exibição; nada de detalhes internos. `EMAIL_ALREADY_REGISTERED` nunca chega
 * aqui (o cadastro o absorve — BR-014).
 */
export const identityErrorMappings: Readonly<Record<string, DomainErrorMapping>> = {
  INVALID_EMAIL_ADDRESS: { status: 400, title: 'E-mail inválido' },
  INVALID_PERSON_NAME: { status: 400, title: 'Nome inválido' },
  PASSWORD_POLICY_VIOLATION: {
    status: 422,
    title: 'A senha não atende aos requisitos',
    violations: (error) =>
      error instanceof PasswordPolicyViolationError
        ? error.violatedRules.map((rule) => ({ field: 'password', message: rule }))
        : [],
  },
  INVALID_CREDENTIALS: { status: 401, title: 'E-mail ou senha incorretos' },
  INVALID_OR_EXPIRED_TOKEN: { status: 400, title: 'Link inválido ou expirado' },
  EMAIL_ALREADY_VERIFIED: { status: 409, title: 'E-mail já confirmado' },
  TOKEN_BELONGS_TO_ANOTHER_ACCOUNT: {
    status: 403,
    title: 'Este link pertence a outra conta. Entre com a conta correta para confirmar.',
  },
  SESSION_REVOKED: { status: 401, title: 'Sessão encerrada. Entre novamente.' },
  SESSION_EXPIRED: { status: 401, title: 'Sessão expirada. Entre novamente.' },
  REFRESH_IN_PROGRESS: { status: 409, title: 'Renovação de sessão em andamento' },
  CURRENT_PASSWORD_INCORRECT: { status: 403, title: 'Senha atual incorreta' },
  SESSION_NOT_FOUND: { status: 404, title: 'Sessão não encontrada' },
  VERSION_CONFLICT: {
    status: 409,
    title: 'Os dados foram alterados por outra operação. Tente novamente.',
  },
};
