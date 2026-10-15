// Textos de interface centralizados (pt-BR) para facilitar a futura internacionalização.
export const layoutMessages = {
  skipLink: 'Pular para o conteúdo',
  userMenu: {
    open: (name: string) => `Menu da conta de ${name}`,
    security: 'Segurança da conta',
    notifications: 'Notificações da conta',
    signOut: 'Sair',
    signOutFailed: 'Não foi possível sair agora. Verifique sua conexão e tente novamente.',
  },
  organizationSwitcher: {
    open: (current: string | null) =>
      current ? `Organização atual: ${current}. Trocar de organização` : 'Escolher organização',
    label: 'Organizações',
    all: 'Todas as organizações',
    create: 'Criar organização',
  },
  verificationBanner: {
    body: (email: string) =>
      `Confirme seu e-mail (${email}) para criar ou entrar em organizações. Use o link que enviamos.`,
    resend: 'Reenviar link',
    resending: 'Enviando…',
    sent: 'Se ainda for possível enviar, um novo link chegará em instantes.',
    failed: 'Não foi possível reenviar agora. Tente novamente em alguns minutos.',
  },
} as const;
