import type { Request } from 'express';
import type { z } from 'zod';
import { HttpError } from '../errors/http-error';

/**
 * Valida o corpo da requisição com o schema do contrato e devolve o valor tipado.
 * Usado dentro do controller (em vez de middleware) para preservar a inferência de tipos.
 * Mensagens de violação vêm do schema e nunca incluem o valor recebido.
 */
export function parseBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): z.output<TSchema> {
  const result = schema.safeParse(request.body ?? {});
  if (result.success) {
    return result.data;
  }
  throw new HttpError(400, 'VALIDATION_FAILED', 'Dados inválidos', {
    violations: result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      message: issue.message,
    })),
  });
}
