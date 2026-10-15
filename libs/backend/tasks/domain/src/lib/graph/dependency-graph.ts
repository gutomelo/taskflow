import { DependencyCycleError, DependencyLimitReachedError } from '../errors';

/** Teto da busca (design: sem SQL recursivo — gatilho do ADR 0014). */
export const GRAPH_LIMITS = { maxDepth: 64, maxNodes: 500 } as const;

/**
 * Para um conjunto de tarefas, as que as bloqueiam: dependências explícitas "bloqueada por" e a
 * **aresta implícita** "pai bloqueado pelas subtarefas obrigatórias" (D4 — BR-001 × BR-006).
 */
export type BlockedByExpander = (taskIds: ReadonlyArray<string>) => Promise<ReadonlyArray<string>>;

/**
 * BR-006: recusa a aresta "`blockedId` bloqueada por `blockingId`" se `blockedId` já for alcançável
 * a partir de `blockingId` seguindo "bloqueada por" (fecharia um ciclo). BFS por níveis, uma
 * consulta por nível, sob o lock do projeto em `tasks`.
 */
export async function assertNoCycle(
  blockedId: string,
  blockingId: string,
  expand: BlockedByExpander,
  limits: Readonly<{ maxDepth: number; maxNodes: number }> = GRAPH_LIMITS,
): Promise<void> {
  if (blockedId === blockingId) throw new DependencyCycleError();
  const visited = new Set<string>([blockingId]);
  let frontier: ReadonlyArray<string> = [blockingId];
  for (let depth = 0; frontier.length > 0; depth += 1) {
    if (depth >= limits.maxDepth) throw new DependencyLimitReachedError();
    const next: string[] = [];
    for (const id of await expand(frontier)) {
      if (id === blockedId) throw new DependencyCycleError();
      if (visited.has(id)) continue;
      visited.add(id);
      if (visited.size > limits.maxNodes) throw new DependencyLimitReachedError();
      next.push(id);
    }
    frontier = next;
  }
}
