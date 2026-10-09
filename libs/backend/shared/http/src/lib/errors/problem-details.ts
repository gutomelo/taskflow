import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ServiceBusyError } from '@taskflow/backend/shared/application';
import { DomainError } from '@taskflow/backend/shared/kernel';
import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@taskflow/contracts';
import { HttpError } from './http-error';

const PROBLEM_TYPE_BASE = 'https://taskflow.dev/problems/';

/** Status padrão de um `DomainError` sem mapeamento explícito: violação de regra de negócio. */
const DEFAULT_DOMAIN_ERROR_STATUS = 422;

type ProblemInput = Omit<ProblemDetails, 'type' | 'requestId' | 'instance'>;

export function sendProblem(response: Response, problem: ProblemInput): void {
  const requestId = response.req.id;
  const body: ProblemDetails = {
    type: `${PROBLEM_TYPE_BASE}${problem.code.toLowerCase().replaceAll('_', '-')}`,
    ...problem,
    instance: response.req.originalUrl.split('?')[0] ?? response.req.originalUrl,
    ...(requestId === undefined ? {} : { requestId: String(requestId) }),
  };
  response.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(body);
}

export const notFoundHandler: RequestHandler = (_request, response) => {
  sendProblem(response, { status: 404, code: 'ROUTE_NOT_FOUND', title: 'Recurso não encontrado' });
};

/** Mapeamento de um código de `DomainError` para status e título exibível (pt-BR). */
export type DomainErrorMapping = Readonly<{ status: number; title: string }>;

export interface ErrorHandlerOptions {
  /** Registro `code → mapeamento`, composto pelos contextos no composition root. */
  readonly domainErrors?: Readonly<Record<string, DomainErrorMapping>>;
}

/** Erros lançados pelo body-parser do Express (payload grande ou JSON malformado). */
function isBodyParserError(error: unknown): error is { status: number; type: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    'status' in error &&
    typeof error.status === 'number' &&
    typeof error.type === 'string'
  );
}

export function createErrorHandler({
  domainErrors = {},
}: ErrorHandlerOptions = {}): ErrorRequestHandler {
  return (error: unknown, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error instanceof HttpError) {
      if (error.retryAfterSeconds !== undefined) {
        response.set('Retry-After', String(error.retryAfterSeconds));
      }
      sendProblem(response, {
        status: error.status,
        code: error.code,
        title: error.title,
        ...(error.detail === undefined ? {} : { detail: error.detail }),
        ...(error.violations === undefined ? {} : { violations: [...error.violations] }),
      });
      return;
    }

    if (error instanceof ServiceBusyError) {
      response.set('Retry-After', String(error.retryAfterSeconds));
      sendProblem(response, {
        status: 503,
        code: error.code,
        title: 'Serviço temporariamente ocupado. Tente novamente em instantes.',
      });
      return;
    }

    if (error instanceof DomainError) {
      const mapping = domainErrors[error.code];
      sendProblem(response, {
        status: mapping?.status ?? DEFAULT_DOMAIN_ERROR_STATUS,
        code: error.code,
        title: mapping?.title ?? 'Operação não permitida',
      });
      return;
    }

    if (isBodyParserError(error) && error.type === 'entity.too.large') {
      sendProblem(response, {
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        title: 'Payload muito grande',
      });
      return;
    }

    if (isBodyParserError(error) && error.type === 'entity.parse.failed') {
      sendProblem(response, { status: 400, code: 'MALFORMED_JSON', title: 'JSON inválido' });
      return;
    }

    // Inesperado: detalhes apenas no log, resposta genérica.
    request.log.error({ err: error }, 'Unhandled error');
    sendProblem(response, {
      status: 500,
      code: 'INTERNAL_ERROR',
      title: 'Erro interno',
      detail: 'Ocorreu um erro inesperado. Informe o requestId ao suporte.',
    });
  };
}
