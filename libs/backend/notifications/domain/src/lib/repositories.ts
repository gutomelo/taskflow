import type { NewNotification, NotificationPosition, NotificationRecord } from './notification';

/** Resultado da gravação de uma notificação (um destinatário). */
export type InsertOutcome = 'created' | 'duplicate' | 'ineligible';

/**
 * Notificações são pessoais: toda operação de leitura ou escrita do usuário recebe
 * `organizationId` **e** `recipientUserId` — não há método "por id" solto (M4 da segurança).
 */
export interface NotificationRepository {
  /** `duplicate` = mesma chave já gravada; `ineligible` = FK recusou (saiu da organização, tarefa excluída). */
  insert(notification: NewNotification): Promise<InsertOutcome>;
  countMentionsSince(
    organizationId: string,
    actorUserId: string,
    recipientUserId: string,
    since: Date,
  ): Promise<number>;
  page(
    organizationId: string,
    recipientUserId: string,
    limit: number,
    after: NotificationPosition | null,
  ): Promise<ReadonlyArray<NotificationRecord>>;
  /** Não lidas mais recentes, até `limit`. */
  recentUnread(
    organizationId: string,
    recipientUserId: string,
    limit: number,
  ): Promise<ReadonlyArray<NotificationRecord>>;
  findOwn(
    organizationId: string,
    recipientUserId: string,
    notificationId: string,
  ): Promise<NotificationRecord | null>;
  markRead(
    organizationId: string,
    recipientUserId: string,
    notificationId: string,
    now: Date,
  ): Promise<void>;
  /** Não lidas até `upTo` (inclusive; `null` = todas). */
  markAllRead(
    organizationId: string,
    recipientUserId: string,
    upTo: NotificationPosition | null,
    now: Date,
  ): Promise<number>;
  /** Pessoas com candidatas ao resumo e preferência ligada (fan-out). */
  digestRecipients(since: Date): Promise<ReadonlyArray<string>>;
  /** Candidatas de uma pessoa, de todas as organizações (não lidas, não enviadas, desde `since`). */
  digestCandidates(
    recipientUserId: string,
    since: Date,
    limit: number,
  ): Promise<ReadonlyArray<NotificationRecord>>;
  /** Só as ainda não enviadas (`emailed_at IS NULL`). */
  markEmailed(
    recipientUserId: string,
    notificationIds: ReadonlyArray<string>,
    now: Date,
  ): Promise<void>;
  /** Apaga até `batchSize` notificações anteriores a `cutoff`; devolve quantas. */
  purgeBefore(cutoff: Date, batchSize: number): Promise<number>;
}

/** Preferência global por usuário (padrão: resumo ligado). */
export interface NotificationPreferenceRepository {
  emailDigest(userId: string): Promise<boolean>;
  setEmailDigest(userId: string, emailDigest: boolean, now: Date): Promise<void>;
}
