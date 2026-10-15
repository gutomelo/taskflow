/**
 * Porta: remoção em massa de dados de identidade vencidos (implementação Prisma em lotes).
 * Cada método devolve quantas linhas principais removeu; dependentes caem por cascata.
 */
export interface IdentityDataRetention {
  /** Sessões revogadas ou expiradas (inatividade ou limite absoluto) antes de `endedBefore`. */
  deleteSessionsEndedBefore(endedBefore: Date): Promise<number>;
  /** Tokens de e-mail consumidos ou expirados antes de `endedBefore`. */
  deleteUserTokensEndedBefore(endedBefore: Date): Promise<number>;
  /**
   * Contas não verificadas criadas antes de `createdBefore` e sem uso de sessão desde
   * `noActivitySince` (`last_used_at`: uma sessão renovada continua contando como uso; T29/I4).
   */
  deleteUnverifiedUsers(criteria: {
    readonly createdBefore: Date;
    readonly noActivitySince: Date;
  }): Promise<number>;
}
