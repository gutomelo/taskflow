import type { NotificationKind } from '@taskflow/contracts';

// Textos de notificações (spec 008, pt-BR), centralizados para a futura internacionalização.
export const notificationsMessages = {
  bell: (count: number, capped: boolean) => {
    if (count === 0) return 'Notificações';
    if (capped) return 'Notificações, mais de 99 não lidas';
    return count === 1 ? 'Notificações, 1 não lida' : `Notificações, ${count} não lidas`;
  },
  badge: (count: number, capped: boolean) => (capped ? '99+' : String(count)),
  arrived: (count: number, capped: boolean) =>
    capped
      ? 'Novas notificações: mais de 99 não lidas.'
      : count === 1
        ? 'Nova notificação: 1 não lida.'
        : `Novas notificações: ${count} não lidas.`,
  title: 'Notificações',
  subtitle: 'Menções e tarefas atribuídas a você nesta organização.',
  loading: 'Carregando notificações…',
  loadFailed: 'Não foi possível carregar as notificações.',
  retry: 'Tentar de novo',
  empty: 'Nenhuma notificação por aqui.',
  loadMore: 'Carregar mais',
  markAllRead: 'Marcar todas como lidas',
  markedAllRead: 'Notificações marcadas como lidas.',
  actionFailed: 'Não foi possível concluir. Tente de novo.',
  unread: 'não lida',
  formerMember: 'Ex-membro',
  phrase: (kind: NotificationKind) =>
    kind === 'mention' ? 'mencionou você em' : 'atribuiu a você',
  preference: {
    title: 'Notificações por e-mail',
    description:
      'Receba, no máximo uma vez por hora, um resumo das notificações não lidas. As notificações dentro do app chegam sempre.',
    label: 'Receber resumo por e-mail',
    loading: 'Carregando preferência…',
    loadFailed: 'Não foi possível carregar a preferência.',
    saved: (on: boolean) => (on ? 'Resumo por e-mail ligado.' : 'Resumo por e-mail desligado.'),
    saveFailed: 'Não foi possível salvar a preferência. Tente de novo.',
  },
  page: {
    title: 'Notificações da conta',
    subtitle: 'Escolha como o TaskFlow avisa você.',
  },
} as const;
