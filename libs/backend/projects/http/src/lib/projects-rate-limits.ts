import type { Request } from 'express';
import type { RateLimitPolicy } from '@taskflow/backend/shared/application';

const HOUR = 60 * 60;

/**
 * Limites de borda por usuário (RNF-06, design da spec 003): edição, mudanças de participantes e
 * arquivamento não inundam o log de segurança. Montados sob o escopo do tenant, que sempre
 * autentica: chave ausente é erro de montagem (`requireKey`). A criação tem limite de negócio no caso de uso
 * (conta tentativas, inclusive chave em uso).
 */
export const PROJECTS_RATE_LIMITS = {
  updateByUser: { name: 'projects.update.user', points: 120, durationSeconds: HOUR },
  memberWritesByUser: { name: 'projects.members.write.user', points: 120, durationSeconds: HOUR },
  archiveByUser: { name: 'projects.archive.user', points: 30, durationSeconds: HOUR },
} as const satisfies Record<string, RateLimitPolicy>;

export const userKey = (request: Request): string | undefined =>
  request.actor ? `user:${request.actor.userId}` : undefined;
