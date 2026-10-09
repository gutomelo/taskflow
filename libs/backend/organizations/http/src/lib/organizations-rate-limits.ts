import type { Request } from 'express';
import type { RateLimitPolicy } from '@taskflow/backend/shared/application';

const HOUR = 60 * 60;

/**
 * Limites de borda (design da spec 002, 429 em lookup/accept). Criação e convites têm limites de
 * negócio nos casos de uso (RNF-04), que contam tentativas e dependem do destinatário.
 */
export const ORGANIZATIONS_RATE_LIMITS = {
  invitationLookupByUser: {
    name: 'organizations.invitation-lookup.user',
    points: 30,
    durationSeconds: HOUR,
  },
  invitationAcceptByUser: {
    name: 'organizations.invitation-accept.user',
    points: 20,
    durationSeconds: HOUR,
  },
} as const satisfies Record<string, RateLimitPolicy>;

export const userKey = (request: Request): string | undefined =>
  request.actor ? `user:${request.actor.userId}` : undefined;
