/**
 * Base de todos os erros de regra de negócio. `code` é estável e legível por máquina
 * (UPPER_SNAKE_CASE) — é ele que a camada HTTP mapeia para status e Problem Details.
 * A mensagem é técnica (para logs), nunca exibida diretamente ao usuário.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
