import type { RateLimitPolicy } from '@taskflow/backend/shared/application';

// RNF-05 (design da spec 010, Abuso).

/** Teto suave: contado sob o `FOR SHARE` da tarefa; comentários simultâneos podem passar dele. */
export const MAX_COMMENTS_PER_TASK = 2_000;

export const COMMENTS_DEFAULT_PAGE = 25;
export const COMMENTS_MAX_PAGE = 100;
export const CANDIDATES_DEFAULT_PAGE = 20;
export const CANDIDATES_MAX_PAGE = 50;
export const CANDIDATE_QUERY_MAX_LENGTH = 50;

/** Espera máxima por lock (como em `tasks`): contenção vira 409 `CONCURRENT_UPDATE`. */
export const COMMENT_LOCK_TIMEOUT_MS = 2_000;

/** Criar, editar e excluir por usuário, contando tentativas recusadas. */
export const COMMENT_WRITE_POLICY = {
  name: 'collaboration.comments.write.user.hour',
  points: 300,
  durationSeconds: 60 * 60,
} as const satisfies RateLimitPolicy;

/** Busca de candidatos a menção (chamada a cada tecla, com debounce). */
export const MENTION_SEARCH_POLICY = {
  name: 'collaboration.mentions.read.user.minute',
  points: 120,
  durationSeconds: 60,
} as const satisfies RateLimitPolicy;
