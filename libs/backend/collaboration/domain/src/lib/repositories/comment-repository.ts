import type { Comment } from '../comment/comment';

/** Uma menção a conferir: pessoa, comentário e a tarefa a que ele deve pertencer. */
export type MentionReference = Readonly<{ taskId: string; commentId: string; userId: string }>;

export const mentionKey = (commentId: string, userId: string) => `${commentId}|${userId}`;

/** Posição na conversa, na ordem `(created_at DESC, id DESC)`. */
export type CommentPosition = Readonly<{ createdAt: Date; id: string }>;

/**
 * Comentários de uma organização. Toda operação filtra `organizationId` em leitura e escrita;
 * escritas só depois do lock da tarefa (design, ordem de locks).
 */
export interface CommentRepository {
  add(comment: Comment): Promise<void>;
  findById(organizationId: string, commentId: string): Promise<Comment | null>;
  /** `FOR NO KEY UPDATE` e releitura. Só em transação. */
  lockById(organizationId: string, commentId: string): Promise<Comment | null>;
  /** Com a versão do snapshot (BR-008): `VERSION_CONFLICT` se mudou; incrementa ao gravar. */
  save(comment: Comment): Promise<void>;
  /** Até `limit` comentários da tarefa depois de `after` (mais recentes primeiro). */
  page(
    organizationId: string,
    taskId: string,
    limit: number,
    after: CommentPosition | null,
  ): Promise<ReadonlyArray<Comment>>;
  /**
   * Spec 008: quais menções ainda existem em comentário **não removido daquela tarefa** — chaves
   * `commentId|userId`. A tarefa entra na conferência (B2 da revisão de segurança da 008).
   */
  activeMentions(
    organizationId: string,
    mentions: ReadonlyArray<MentionReference>,
  ): Promise<ReadonlySet<string>>;
  /** Comentários não removidos da tarefa (RF-13 e teto suave). */
  countActive(organizationId: string, taskId: string): Promise<number>;
}
