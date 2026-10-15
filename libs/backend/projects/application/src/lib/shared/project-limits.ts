import type { RateLimitPolicy } from '@taskflow/backend/shared/application';

/** RNF-06: projetos por organização, ativos e arquivados (limite contra abuso). */
export const MAX_PROJECTS_PER_ORGANIZATION = 1000;

/** RNF-06: participantes por projeto (limita também a exclusão na lista de candidatos). */
export const MAX_MEMBERS_PER_PROJECT = 500;

/**
 * RNF-06: criação por usuário, contando tentativas — inclusive as recusadas por chave em uso, o
 * que limita a inferência de chaves de projetos ocultos (design, riscos aceitos).
 */
export const PROJECT_CREATION_POLICY = {
  name: 'projects.create.user.hour',
  points: 30,
  durationSeconds: 60 * 60,
} as const satisfies RateLimitPolicy;
