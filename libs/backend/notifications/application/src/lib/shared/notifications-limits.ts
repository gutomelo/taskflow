import type { RateLimitPolicy } from '@taskflow/backend/shared/application';

// RNF-05 (design da spec 008): limites por usuário das rotas de leitura e escrita.

export const NOTIFICATIONS_DEFAULT_PAGE = 25;
export const NOTIFICATIONS_MAX_PAGE = 50;
/** Lotes da retenção (não competem com a cascata da membership). */
export const PURGE_BATCH = 1_000;

export const NOTIFICATIONS_COUNT_POLICY = {
  name: 'notifications.count.user.minute',
  points: 120,
  durationSeconds: 60,
} as const satisfies RateLimitPolicy;

export const NOTIFICATIONS_LIST_POLICY = {
  name: 'notifications.list.user.minute',
  points: 60,
  durationSeconds: 60,
} as const satisfies RateLimitPolicy;

export const NOTIFICATIONS_WRITE_POLICY = {
  name: 'notifications.write.user.minute',
  points: 60,
  durationSeconds: 60,
} as const satisfies RateLimitPolicy;
