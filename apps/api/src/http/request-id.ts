import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Aceita IDs de proxies/clientes apenas se forem curtos e seguros para logs e headers.
const ACCEPTED_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function resolveRequestId(request: IncomingMessage, response: ServerResponse): string {
  const incoming = request.headers[REQUEST_ID_HEADER];
  const requestId =
    typeof incoming === 'string' && ACCEPTED_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  response.setHeader(REQUEST_ID_HEADER, requestId);
  return requestId;
}
