/**
 * Erro de transporte HTTP com código estável. Erros de domínio terão sua própria
 * hierarquia (DomainError) e serão mapeados no error handler quando existirem.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(detail ?? title);
    this.name = 'HttpError';
  }
}
