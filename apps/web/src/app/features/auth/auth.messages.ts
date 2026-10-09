import type { PasswordRule } from '@taskflow/contracts';
import type { ApiProblem } from '../../core/http/api-problem';

// Textos de interface centralizados (pt-BR) para facilitar a futura internacionalização.
export const authMessages = {
  fields: {
    name: 'Nome',
    email: 'E-mail',
    password: 'Senha',
    showPassword: 'Mostrar senha',
    hidePassword: 'Ocultar senha',
  },
  validation: {
    nameRequired: 'Informe seu nome.',
    nameTooLong: 'Use no máximo 100 caracteres.',
    emailRequired: 'Informe seu e-mail.',
    emailInvalid: 'Informe um e-mail válido, como nome@exemplo.com.',
    passwordRequired: 'Informe sua senha.',
    passwordPolicy: 'A senha ainda não atende a todos os requisitos.',
  },
  login: {
    title: 'Entrar no TaskFlow',
    subtitle: 'Use seu e-mail e senha.',
    submit: 'Entrar',
    submitting: 'Entrando…',
    noAccount: 'Ainda não tem conta?',
    registerLink: 'Criar conta',
    invalidCredentials: 'E-mail ou senha incorretos.',
  },
  register: {
    title: 'Criar conta',
    subtitle: 'Leva menos de um minuto.',
    submit: 'Criar conta',
    submitting: 'Criando conta…',
    hasAccount: 'Já tem conta?',
    loginLink: 'Entrar',
    successTitle: 'Confira seu e-mail',
    // BR-014: a mesma mensagem para endereço novo ou já cadastrado (sem enumeração de contas).
    successBody: (email: string) =>
      `Enviamos as próximas instruções para ${email}. Abra o link do e-mail para confirmar sua conta. Não chegou em alguns minutos? Verifique a pasta de spam.`,
    successAction: 'Ir para o login',
  },
  passwordRequirements: {
    heading: 'A senha precisa ter:',
    met: 'atendido',
    pending: 'pendente',
    allMet: 'Todos os requisitos de senha foram atendidos.',
    pendingSummary: (labels: ReadonlyArray<string>) =>
      `Requisitos pendentes: ${labels.join('; ')}.`,
    rules: {
      min_length: 'pelo menos 8 caracteres',
      max_length: 'no máximo 128 caracteres',
      uppercase: 'uma letra maiúscula',
      lowercase: 'uma letra minúscula',
      digit: 'um número',
      symbol: 'um símbolo, como ! ? @ #',
      same_as_email: 'ser diferente do seu e-mail',
      common_password: 'não ser uma senha comum ou já vazada',
    } satisfies Record<PasswordRule, string>,
  },
  errors: {
    network: 'Sem conexão com o servidor. Verifique sua internet e tente novamente.',
    rateLimited: (seconds: number | null) =>
      seconds
        ? `Muitas tentativas. Aguarde ${seconds} segundos e tente novamente.`
        : 'Muitas tentativas. Aguarde um pouco e tente novamente.',
    busy: 'O serviço está ocupado agora. Tente novamente em instantes.',
    csrf: 'Sua proteção de segurança expirou. Recarregue a página e tente novamente.',
    invalidData: 'Revise os campos destacados.',
    unexpected: 'Algo deu errado. Tente novamente.',
  },
} as const;

/** Mensagens comuns a todos os formulários de autenticação; `null` se o código for específico. */
export function commonErrorMessage(problem: ApiProblem): string | null {
  if (problem.status === 0) return authMessages.errors.network;
  if (problem.code === 'RATE_LIMITED')
    return authMessages.errors.rateLimited(problem.retryAfterSeconds);
  if (problem.code === 'SERVICE_BUSY') return authMessages.errors.busy;
  if (problem.code === 'CSRF_VALIDATION_FAILED') return authMessages.errors.csrf;
  if (problem.code === 'VALIDATION_FAILED') return authMessages.errors.invalidData;
  return null;
}

/** Regras conhecidas pela interface (as chaves de `rules` cobrem todo `PasswordRule`). */
export function isPasswordRule(value: string): value is PasswordRule {
  return Object.hasOwn(authMessages.passwordRequirements.rules, value);
}
