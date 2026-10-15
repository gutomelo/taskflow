import type { ApiProblem } from '../../core/http/api-problem';

// Textos de interface centralizados (pt-BR) para facilitar a futura internacionalização.
export const formMessages = {
  showPassword: 'Mostrar senha',
  hidePassword: 'Ocultar senha',
  passwordRequired: 'Informe sua senha.',
  passwordPolicy: 'A senha ainda não atende a todos os requisitos.',
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

/** Mensagens comuns a todos os formulários; `null` se o código pede tratamento específico. */
export function commonErrorMessage(problem: ApiProblem): string | null {
  const { errors } = formMessages;
  if (problem.status === 0) return errors.network;
  if (problem.code === 'RATE_LIMITED') return errors.rateLimited(problem.retryAfterSeconds);
  if (problem.code === 'SERVICE_BUSY') return errors.busy;
  if (problem.code === 'CSRF_VALIDATION_FAILED') return errors.csrf;
  if (problem.code === 'VALIDATION_FAILED') return errors.invalidData;
  return null;
}
