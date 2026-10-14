import { HttpErrorResponse } from '@angular/common/http';
import type { FieldViolation } from '@taskflow/contracts';
import { isProblemDetails } from './contract-guards';

/** Erro da API reduzido ao que a interface usa para decidir a mensagem (sempre por `code`). */
export type ApiProblem = Readonly<{
  /** 0 quando não houve resposta (rede, CORS, timeout). */
  status: number;
  code: string | null;
  violations: ReadonlyArray<FieldViolation>;
  /** Do header `Retry-After` (429/503), em segundos. */
  retryAfterSeconds: number | null;
  /** Extensão da spec 004: tarefas que impedem a operação (BR-001/BR-006). */
  taskIds: ReadonlyArray<string>;
}>;

export function toApiProblem(error: unknown): ApiProblem {
  if (!(error instanceof HttpErrorResponse)) {
    return { status: 0, code: null, violations: [], retryAfterSeconds: null, taskIds: [] };
  }
  const body: unknown = error.error;
  const problem = isProblemDetails(body) ? body : null;
  const retryAfter = Number(error.headers.get('Retry-After'));
  return {
    status: error.status,
    code: problem?.code ?? null,
    violations: problem?.violations ?? [],
    taskIds: problem?.taskIds ?? [],
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : null,
  };
}
