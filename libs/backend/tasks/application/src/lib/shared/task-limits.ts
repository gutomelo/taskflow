import type { RateLimitPolicy } from '@taskflow/backend/shared/application';

// RNF-05 (D3 do design da spec 004).

/** Tarefas por projeto, sobre o contador: inclui as excluídas (números nunca reutilizados). */
export const MAX_TASKS_PER_PROJECT = 10_000;
export const MAX_TASKS_PER_ORGANIZATION = 100_000;
export const MAX_SUBTASKS_PER_TASK = 100;
export const MAX_BLOCKERS_PER_TASK = 50;
export const MAX_DEPENDENCIES_PER_PROJECT = 5_000;
/** "Bloqueia" no detalhe: até 50, com `blockingTruncated`. */
export const MAX_BLOCKING_IN_DETAIL = 50;

/**
 * Espera máxima por lock nas escritas de tarefa (design, Abuso): contenção vira 409
 * `CONCURRENT_UPDATE` em 2 s em vez de segurar conexões do pool até o timeout da transação.
 */
export const TASK_LOCK_TIMEOUT_MS = 2_000;

/** Criação por usuário, contando tentativas recusadas. */
export const TASK_CREATION_POLICY = {
  name: 'tasks.create.user.hour',
  points: 300,
  durationSeconds: 60 * 60,
} as const satisfies RateLimitPolicy;

/** Demais escritas por usuário (editar, atribuir, mover, cancelar, reabrir, excluir, dependências). */
export const TASK_WRITE_POLICY = {
  name: 'tasks.write.user.hour',
  points: 1200,
  durationSeconds: 60 * 60,
} as const satisfies RateLimitPolicy;

/** Quadro (spec 005, D5): cards por coluna na carga do quadro e na coluna paginada. */
export const BOARD_DEFAULT_CARDS = 25;
export const BOARD_MAX_CARDS = 50;
export const COLUMN_DEFAULT_CARDS = 50;
export const COLUMN_MAX_CARDS = 100;

/** Rebalanceamentos de coluna por projeto (M1 da segurança): raros pelo esquema de chaves. */
export const TASK_REBALANCE_POLICY = {
  name: 'tasks.rebalance.project.hour',
  points: 30,
  durationSeconds: 60 * 60,
} as const satisfies RateLimitPolicy;
