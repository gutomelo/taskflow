import type { Session, SessionRevocationReason } from '../session/session';

export interface SessionRepository {
  add(session: Session): Promise<void>;
  /**
   * Localiza a sessão dona do refresh token e a **bloqueia** (`SELECT … FOR UPDATE`) até o
   * fim da transação, serializando renovações concorrentes (BR-012). Deve ser chamado dentro
   * de `TransactionRunner.run`. Retorna `null` se o hash não pertencer a nenhuma sessão.
   */
  findByRefreshTokenHashForUpdate(tokenHash: string): Promise<Session | null>;
  findById(sessionId: string): Promise<Session | null>;
  /**
   * Como `findById`, mas **bloqueia** a sessão até o fim da transação: logout e revogação
   * gravam sobre o estado mais recente, sem corrida com um refresh concorrente (T29/I1).
   */
  findByIdForUpdate(sessionId: string): Promise<Session | null>;
  /** Sessões não revogadas e não expiradas do usuário, mais recentes primeiro. */
  listActiveByUser(userId: string, now: Date): Promise<ReadonlyArray<Session>>;
  /** Persiste estado da sessão e de seus tokens (rotação, tolerância, revogação). */
  save(session: Session): Promise<void>;
  /**
   * Revoga todas as sessões ativas do usuário (BR-016), exceto `exceptSessionId`.
   * Retorna os ids revogados para alimentar a lista de revogação.
   */
  revokeAllForUser(
    userId: string,
    reason: SessionRevocationReason,
    now: Date,
    options?: { readonly exceptSessionId?: string },
  ): Promise<ReadonlyArray<string>>;
}
