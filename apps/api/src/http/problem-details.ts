import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@taskflow/contracts';
import { HttpError } from './http-error';

const PROBLEM_TYPE_BASE = 'https://taskflow.dev/problems/';

function sendProblem(
  response: Response,
  problem: Omit<ProblemDetails, 'type' | 'requestId'>,
): void {
  const requestId = response.req.id;
  const body: ProblemDetails = {
    type: `${PROBLEM_TYPE_BASE}${problem.code.toLowerCase().replaceAll('_', '-')}`,
    ...problem,
    instance: response.req.originalUrl,
    ...(typeof requestId === 'string' ? { requestId } : {}),
  };
  response.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(body);
}

export const notFoundHandler: RequestHandler = (_request, response) => {
  sendProblem(response, {
    status: 404,
    code: 'ROUTE_NOT_FOUND',
    title: 'Recurso não encontrado',
  });
};

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

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    sendProblem(response, {
      status: error.status,
      code: error.code,
      title: error.title,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
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
