import type { IncomingMessage, ServerResponse } from 'node:http';

type RequestWithId = IncomingMessage & { id?: unknown };

/**
 * Serializers mínimos para pino-http: nada de headers completos (cookies, tokens CSRF,
 * `x-forwarded-for` com IP completo) nem query string (pode conter tokens de link).
 */
export const httpLogSerializers = {
  req(request: RequestWithId) {
    return {
      id: request.id,
      method: request.method,
      path: (request.url ?? '').split('?')[0],
      userAgent: request.headers['user-agent'],
    };
  },
  res(response: ServerResponse) {
    return { statusCode: response.statusCode };
  },
};
