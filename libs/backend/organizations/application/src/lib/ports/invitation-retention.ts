/** Porta: remoção em massa de convites encerrados (implementação Prisma em lotes). */
export interface InvitationRetention {
  /**
   * Convites aceitos, revogados ou expirados antes de `closedBefore` (RNF-08). Devolve quantos
   * removeu. Convites abertos dentro do prazo nunca são tocados.
   */
  deleteClosedBefore(closedBefore: Date): Promise<number>;
}
