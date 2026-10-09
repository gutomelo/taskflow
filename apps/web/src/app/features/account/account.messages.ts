import type { SessionSummary } from '@taskflow/contracts';
import { formMessages } from '../../shared/forms/form.messages';

// Textos de interface centralizados (pt-BR) para facilitar a futura internacionalização.
export const accountMessages = {
  security: {
    title: 'Segurança da conta',
    subtitle: 'Gerencie onde sua conta está conectada e a sua senha.',
  },
  sessions: {
    title: 'Sessões ativas',
    description: 'Dispositivos conectados à sua conta. Encerre os que você não reconhece.',
    loading: 'Carregando sessões…',
    loadFailed: 'Não foi possível carregar as sessões.',
    retry: 'Tentar novamente',
    current: 'Esta sessão',
    createdAt: (date: string) => `Conectada em ${date}`,
    lastUsedAt: (date: string) => `Último uso em ${date}`,
    revoke: 'Encerrar',
    revokeCurrent: 'Sair deste dispositivo',
    revokeLabel: (device: string, date: string) =>
      `Encerrar sessão ${device}, último uso em ${date}`,
    revoking: 'Encerrando…',
    revoked: 'Sessão encerrada.',
    revokeFailed: 'Não foi possível encerrar a sessão. Tente novamente.',
    unknownBrowser: 'Navegador desconhecido',
    device: (browser: string, os: string | null) => (os ? `${browser} no ${os}` : browser),
  },
  changePassword: {
    title: 'Trocar senha',
    description: 'Ao trocar a senha, as sessões em outros dispositivos são encerradas.',
    currentPassword: 'Senha atual',
    newPassword: 'Nova senha',
    submit: 'Trocar senha',
    submitting: 'Trocando…',
    done: 'Senha alterada. As sessões em outros dispositivos foram encerradas.',
    currentIncorrect: 'A senha atual está incorreta.',
    showPassword: formMessages.showPassword,
    hidePassword: formMessages.hidePassword,
    passwordRequired: formMessages.passwordRequired,
    passwordPolicy: formMessages.passwordPolicy,
  },
  errors: formMessages.errors,
} as const;

/** Texto do dispositivo a partir dos dados estruturados da API (design: o frontend compõe). */
export function deviceLabel(device: SessionSummary['device']): string {
  return accountMessages.sessions.device(
    device.browser ?? accountMessages.sessions.unknownBrowser,
    device.os,
  );
}

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function formatDateTime(isoDate: string): string {
  return DATE_TIME.format(new Date(isoDate));
}
