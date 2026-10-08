import type { FieldViolation } from '@taskflow/contracts';

export interface HttpErrorOptions {
  readonly detail?: string;
  readonly violations?: ReadonlyArray<FieldViolation>;
  /** Enviado como header `Retry-After` (respostas 429/503). */
  readonly retryAfterSeconds?: number;
}

/**
 * Erro de transporte HTTP com código estável. Regras de negócio usam `DomainError`
 * (kernel), mapeado pelo error handler; este tipo cobre autenticação, CSRF,
 * validação de entrada e limites de taxa.
 */
export class HttpError extends Error {
  readonly detail: string | undefined;
  readonly violations: ReadonlyArray<FieldViolation> | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    options: HttpErrorOptions = {},
  ) {
    super(options.detail ?? title);
    this.name = 'HttpError';
    this.detail = options.detail;
    this.violations = options.violations;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
