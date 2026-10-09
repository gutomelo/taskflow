import type { FieldViolation, PasswordRule } from '@taskflow/contracts';
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
    forgotLink: 'Esqueci minha senha',
    invalidCredentials: 'E-mail ou senha incorretos.',
  },
  verifyEmail: {
    title: 'Confirmar e-mail',
    readyBody: (email: string) =>
      `Confirme que ${email} é o seu endereço. Por segurança, a confirmação só acontece quando você clica no botão.`,
    confirm: 'Confirmar e-mail',
    confirming: 'Confirmando…',
    needsLoginBody:
      'Entre na conta que recebeu este link para confirmar o e-mail. O link continua guardado nesta aba enquanto você entra.',
    needsLoginAction: 'Entrar para confirmar',
    verifiedTitle: 'E-mail confirmado',
    verifiedBody: 'Tudo certo! Seu e-mail foi confirmado.',
    alreadyVerifiedBody: 'Seu e-mail já está confirmado. Não é preciso fazer mais nada.',
    continue: 'Continuar',
    wrongAccountBody:
      'Este link pertence a outra conta. Saia desta conta e entre com a conta que recebeu o e-mail para confirmar.',
    invalidLinkBody:
      'Este link é inválido ou expirou (links de confirmação valem 24 horas). Peça um novo link abaixo.',
    noTokenBody:
      'Não encontramos um link de confirmação. Abra o link recebido por e-mail ou peça um novo.',
    noTokenAnonymousBody:
      'Não encontramos um link de confirmação. Abra o link recebido por e-mail para confirmar sua conta.',
    resend: 'Enviar novo link',
    resending: 'Enviando…',
    resendSent: 'Se ainda for possível enviar, um novo link chegará ao seu e-mail em instantes.',
  },
  forgotPassword: {
    title: 'Esqueci minha senha',
    subtitle: 'Informe o e-mail da sua conta para receber um link de redefinição.',
    submit: 'Enviar link',
    submitting: 'Enviando…',
    sentTitle: 'Confira seu e-mail',
    // BR-014: a resposta não revela se o endereço tem conta.
    sentBody: (email: string) =>
      `Se houver uma conta com ${email}, enviaremos um link para redefinir a senha. O link vale por 30 minutos.`,
    backToLogin: 'Voltar para o login',
  },
  resetPassword: {
    title: 'Redefinir senha',
    subtitle: 'Escolha uma nova senha para a sua conta.',
    newPassword: 'Nova senha',
    submit: 'Redefinir senha',
    submitting: 'Redefinindo…',
    doneTitle: 'Senha redefinida',
    doneBody:
      'Sua senha foi alterada e todas as sessões abertas foram encerradas. Entre com a nova senha.',
    goToLogin: 'Entrar',
    invalidLinkTitle: 'Link inválido ou expirado',
    invalidLinkBody:
      'Links de redefinição valem 30 minutos e só podem ser usados uma vez. Peça um novo link.',
    requestNewLink: 'Pedir novo link',
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

/** Regras de senha recusadas pela API (`PASSWORD_POLICY_VIOLATION`), ignorando desconhecidas. */
export function passwordRulesFrom(violations: ReadonlyArray<FieldViolation>): PasswordRule[] {
  return violations
    .filter((violation) => violation.field === 'password')
    .map((violation) => violation.message)
    .filter(isPasswordRule);
}
