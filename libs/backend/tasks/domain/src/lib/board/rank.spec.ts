import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FIRST_RANK,
  isValidRank,
  keyAfter,
  keyBefore,
  keyBetween,
  needsRebalance,
  RANK_REBALANCE_LENGTH,
  RankOrderError,
  spreadKeys,
} from './rank';

/** Gerador pseudoaleatório determinístico (os testes de propriedade são reproduzíveis). */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const ascending = (keys: ReadonlyArray<string>) =>
  keys.every((key, index) => index === 0 || (keys[index - 1] ?? '') < key);

describe('board rank (BR-009, ADR 0007)', () => {
  it('starts at a0 and keeps order between, before and after', () => {
    expect(keyBetween(null, null)).toBe(FIRST_RANK);
    const after = keyAfter(FIRST_RANK);
    const before = keyBefore(FIRST_RANK);
    const middle = keyBetween(FIRST_RANK, after);
    expect(ascending([before, FIRST_RANK, middle, after])).toBe(true);
    for (const key of [before, middle, after]) expect(isValidRank(key)).toBe(true);
  });

  it('is deterministic', () => {
    expect(keyBetween('a0', 'a1')).toBe(keyBetween('a0', 'a1'));
    expect(keyAfter('e00042')).toBe('e00043');
  });

  it('accepts the backfill keys of migration (e + 5 digits) and goes after them', () => {
    const backfill = Array.from(
      { length: 10_000 },
      (_, index) => `e${String(index + 1).padStart(5, '0')}`,
    );
    expect(backfill.every(isValidRank)).toBe(true);
    expect(ascending(backfill)).toBe(true);
    const next = keyAfter(backfill.at(-1) ?? null);
    expect(next > (backfill.at(-1) ?? '')).toBe(true);
  });

  it('10 000 appends and 10 000 insertions at the top stay short (logarithmic growth)', () => {
    let last: string | null = null;
    let first: string | null = null;
    const appended: string[] = [];
    const prepended: string[] = [];
    for (let index = 0; index < 10_000; index += 1) {
      last = keyAfter(last);
      first = keyBefore(first);
      appended.push(last);
      prepended.unshift(first);
    }
    expect(ascending(appended)).toBe(true);
    expect(ascending(prepended)).toBe(true);
    expect(Math.max(...appended.map((key) => key.length))).toBeLessThanOrEqual(
      RANK_REBALANCE_LENGTH,
    );
    expect(Math.max(...prepended.map((key) => key.length))).toBeLessThanOrEqual(
      RANK_REBALANCE_LENGTH,
    );
  });

  it('repeated insertions at the same middle point grow and ask for a rebalance', () => {
    const low = 'a0';
    let high = 'a1';
    let rebalanceAt = -1;
    for (let index = 0; index < 500 && rebalanceAt < 0; index += 1) {
      high = keyBetween(low, high);
      if (needsRebalance(high)) rebalanceAt = index;
    }
    expect(rebalanceAt).toBeGreaterThan(20);
    expect(high.length).toBe(RANK_REBALANCE_LENGTH + 1);
    expect(needsRebalance(`a${'1'.repeat(RANK_REBALANCE_LENGTH - 1)}`)).toBe(false);
    expect(needsRebalance(`a${'1'.repeat(RANK_REBALANCE_LENGTH)}`)).toBe(true);
  });

  it('property: random insertions keep a strictly increasing, valid list', () => {
    const next = random(42);
    const keys: string[] = [];
    for (let step = 0; step < 3_000; step += 1) {
      const at = Math.floor(next() * (keys.length + 1));
      const key = keyBetween(keys[at - 1] ?? null, keys[at] ?? null);
      keys.splice(at, 0, key);
    }
    expect(ascending(keys)).toBe(true);
    expect(keys.every(isValidRank)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('spreads keys for a rebalance: increasing, valid and short', () => {
    const keys = spreadKeys(10_000);
    expect(ascending(keys)).toBe(true);
    expect(keys.every((key) => isValidRank(key) && key.length <= 4)).toBe(true);
  });

  it('ties or inverted bounds are a programming error, never a silent wrong key', () => {
    expect(() => keyBetween('a1', 'a1')).toThrow(RankOrderError);
    expect(() => keyBetween('a2', 'a1')).toThrow(RankOrderError);
    expect(() => keyBetween('a10', null)).toThrow(RankOrderError); // fração terminando em 0
  });

  it('validates the alphabet, the head, the length and the trailing zero', () => {
    for (const key of ['', 'a', 'a0_', 'é0', '0a', 'a10', `a1${'1'.repeat(70)}`]) {
      expect(isValidRank(key), key).toBe(false);
    }
    for (const key of ['a0', 'a1V', 'Zz', 'e00042', 'b10'])
      expect(isValidRank(key), key).toBe(true);
  });

  it('orders by code unit like the "C" collation (uppercase before lowercase), without localeCompare', () => {
    expect('aZ' < 'aa').toBe(true);
    expect(keyBetween('aZ', 'aa') > 'aZ').toBe(true);
    const source = readFileSync(join(__dirname, 'rank.ts'), 'utf8');
    expect(source.replace(/\/\/.*$/gm, '')).not.toContain('localeCompare');
  });
});
