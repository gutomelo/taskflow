import express, { type Express, type RequestHandler } from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import { createErrorHandler, type ErrorHandlerOptions } from '../errors/problem-details';

/** App Express mínimo para testar middlewares isoladamente (apenas em testes). */
export function createTestApp(
  configure: (app: Express) => void,
  errorHandlerOptions?: ErrorHandlerOptions,
): Express {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.use(express.json());
  configure(app);
  app.use(createErrorHandler(errorHandlerOptions));
  return app;
}

/** Simula `createAuthenticate` a partir de um header de teste. */
export const fakeActorFromHeader: RequestHandler = (request, _response, next) => {
  const sessionId = request.get('x-test-session');
  if (sessionId) {
    request.actor = { userId: 'user-1', sessionId };
  }
  next();
};
