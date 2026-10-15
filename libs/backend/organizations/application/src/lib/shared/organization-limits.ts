import type { RateLimitPolicy } from '@taskflow/backend/shared/application';

const DAY = 24 * 60 * 60;

/** RNF-04: organizações das quais um usuário pode ser owner. */
export const MAX_OWNED_ORGANIZATIONS = 20;

/** RNF-04: memberships por usuário (imposto na criação e no aceite; limita "minhas organizações"). */
export const MAX_MEMBERSHIPS_PER_USER = 100;

/**
 * RNF-04: criação de organização por usuário, contando tentativas — inclusive as recusadas por
 * slug em uso, o que limita a enumeração de slugs (design, "Enumeração").
 */
export const ORGANIZATION_CREATION_POLICY = {
  name: 'organizations.create.user.day',
  points: 5,
  durationSeconds: DAY,
} as const satisfies RateLimitPolicy;
