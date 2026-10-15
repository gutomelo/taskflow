import { NotificationNotFoundError } from './errors';

export const NOTIFICATION_KINDS = ['mention', 'assignment'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** BR-033 e design da spec 008 (limites). */
export const NOTIFICATION_LIMITS = {
  /** Menções de um mesmo ator para um mesmo destinatário, por organização e hora (decisão 9). */
  mentionsPerActorAndRecipientPerHour: 20,
  /** Itens por resumo; o resto fica para o próximo. */
  digestMaxItems: 50,
  /** Só notificações recentes entram no resumo (decisão 10). */
  digestWindowHours: 24,
  retentionDays: 90,
  /** O contador analisa no máximo estas não lidas mais recentes e satura no teto. */
  unreadScan: 200,
  unreadCap: 99,
} as const;

/**
 * Chaves de deduplicação por destinatário (D4): a menção vale para o comentário enquanto a
 * notificação existir; a atribuição, por evento.
 */
export const dedupeKey = {
  mention: (commentId: string) => `mention:${commentId}`,
  assignment: (sourceEventId: string) => `assignment:${sourceEventId}`,
} as const;

export type NotificationRecord = Readonly<{
  id: string;
  organizationId: string;
  recipientUserId: string;
  kind: NotificationKind;
  actorUserId: string;
  projectId: string;
  taskId: string;
  /** Só em menções. */
  commentId: string | null;
  dedupeKey: string;
  sourceEventId: string;
  /** Hora do fato (do evento), não do processamento: janela do teto, ordem e retenção. */
  occurredAt: Date;
  createdAt: Date;
  readAt: Date | null;
  emailedAt: Date | null;
}>;

export type NewNotification = Omit<NotificationRecord, 'readAt' | 'emailedAt'>;

/** Posição na lista, na ordem `(occurred_at DESC, id DESC)`. */
export type NotificationPosition = Readonly<{ occurredAt: Date; id: string }>;

/** Fato recebido de um produtor, já traduzido para a linguagem de `notifications`. */
export type NotificationFact = Readonly<{
  kind: NotificationKind;
  organizationId: string;
  projectId: string;
  taskId: string;
  commentId: string | null;
  actorUserId: string;
  recipientUserIds: ReadonlyArray<string>;
  sourceEventId: string;
  occurredAt: Date;
}>;

/** Destinatários de um fato: sem o próprio ator e sem repetição (BR-033). */
export function recipientsOf(fact: NotificationFact): ReadonlyArray<string> {
  return [...new Set(fact.recipientUserIds)].filter((userId) => userId !== fact.actorUserId);
}

export function dedupeKeyOf(fact: NotificationFact): string {
  if (fact.kind === 'mention') {
    if (fact.commentId === null) throw new Error('A mention needs its comment');
    return dedupeKey.mention(fact.commentId);
  }
  return dedupeKey.assignment(fact.sourceEventId);
}

/** Notificação própria ou o mesmo 404 (alheia, inexistente ou invisível). */
export function requireOwn<T>(found: T | null | undefined): T {
  if (found === null || found === undefined) throw new NotificationNotFoundError();
  return found;
}
