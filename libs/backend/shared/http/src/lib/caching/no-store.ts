import type { RequestHandler } from 'express';

/**
 * Respostas tenant-scoped nunca vão para cache compartilhado (dados por usuário e capacidades).
 * Uma única função exportada: o harness de isolamento (spec 006) a reconhece por identidade, não
 * pelo nome — outro middleware chamado `noStore` não escaparia da varredura.
 */
export const noStore: RequestHandler = (_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
};
