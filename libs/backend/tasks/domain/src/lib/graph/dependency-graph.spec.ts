import { DependencyCycleError, DependencyLimitReachedError } from '../errors';
import { assertNoCycle, type BlockedByExpander } from './dependency-graph';

/** "bloqueada por": chave bloqueada pelos valores. */
function expanderOf(edges: Record<string, string[]>): BlockedByExpander & { calls: number } {
  const expand = Object.assign(
    async (ids: ReadonlyArray<string>) => {
      expand.calls += 1;
      return ids.flatMap((id) => edges[id] ?? []);
    },
    { calls: 0 },
  );
  return expand;
}

describe('assertNoCycle (BR-006)', () => {
  it('BR-006: refuses self dependency and direct or indirect cycles', async () => {
    const edges = expanderOf({ B: ['C'], C: ['D'] });

    await expect(assertNoCycle('A', 'A', edges)).rejects.toThrow(DependencyCycleError);
    await expect(assertNoCycle('D', 'B', edges)).rejects.toThrow(DependencyCycleError);
    await expect(assertNoCycle('A', 'B', edges)).resolves.toBeUndefined();
  });

  it('D4: the implicit edge "parent blocked by required subtasks" counts', async () => {
    // P bloqueada (implicitamente) pela subtarefa obrigatória S: S não pode ser bloqueada por P.
    const edges = expanderOf({ P: ['S'] });

    await expect(assertNoCycle('S', 'P', edges)).rejects.toThrow(DependencyCycleError);
  });

  it('stops at the depth and node limits', async () => {
    const chain = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`n${i}`, [`n${i + 1}`]]),
    );
    await expect(
      assertNoCycle('X', 'n0', expanderOf(chain), { maxDepth: 5, maxNodes: 100 }),
    ).rejects.toThrow(DependencyLimitReachedError);
    const wide = expanderOf({ root: Array.from({ length: 20 }, (_, i) => `c${i}`) });
    await expect(assertNoCycle('X', 'root', wide, { maxDepth: 5, maxNodes: 10 })).rejects.toThrow(
      DependencyLimitReachedError,
    );
  });

  it('queries once per level and visits each task once', async () => {
    const edges = expanderOf({ A: ['B', 'C'], B: ['D'], C: ['D'], D: [] });

    await assertNoCycle('X', 'A', edges);

    expect(edges.calls).toBe(3);
  });
});
