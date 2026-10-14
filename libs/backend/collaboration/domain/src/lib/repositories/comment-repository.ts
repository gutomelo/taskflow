import type { Comment } from '../comment/comment';

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
  /** Comentários não removidos da tarefa (RF-13 e teto suave). */
  countActive(organizationId: string, taskId: string): Promise<number>;
}
