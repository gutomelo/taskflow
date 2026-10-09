/**
 * Lista de revogação consultada a cada requisição autenticada (RNF-08: ≤ 1 s).
 * `revoke` é chamado **antes** do commit da revogação e falha alto se não conseguir gravar
 * (não deixar access token revogado válido); `isRevoked` deve recorrer à fonte da verdade
 * (banco) quando o armazenamento rápido estiver indisponível.
 */
export interface SessionRevocationList {
  revoke(sessionIds: ReadonlyArray<string>): Promise<void>;
  isRevoked(sessionId: string): Promise<boolean>;
}
