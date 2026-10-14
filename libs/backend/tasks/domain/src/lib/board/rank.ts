// Chave de posição do card no quadro (BR-009, ADR 0007): fractional indexing implementado à mão
// (decisão 8 da spec 005, sem dependência). Alfabeto base 62 em ordem ASCII; as chaves são
// comparadas só com `<`/`>` de string (código UTF-16 = ASCII aqui), igual à collation "C" do banco.
// Nunca usar `localeCompare` (ordem dependente de locale).

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const LAST_DIGIT = 'z';
/** Primeira chave de uma coluna vazia. */
export const FIRST_RANK = 'a0';
const SMALLEST_INTEGER = `A${'0'.repeat(26)}`;
/** Acima disso a coluna é rebalanceada (só no movimento, que segura o lock do projeto). */
export const RANK_REBALANCE_LENGTH = 32;
/** Limite absoluto (CHECK do banco). */
export const RANK_MAX_LENGTH = 64;

/** Chamada inválida (`a >= b`, chave malformada): erro de programação, nunca de usuário. */
export class RankOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RankOrderError';
  }
}

const digitOf = (char: string | undefined) => (char === undefined ? -1 : DIGITS.indexOf(char));

/** Tamanho da parte inteira (com a cabeça): `a`…`z` = 2…27 (positivos), `Z`…`A` = 2…27. */
function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new RankOrderError(`invalid rank head: ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(key.charAt(0));
  if (length > key.length) throw new RankOrderError(`invalid rank: ${key}`);
  return key.slice(0, length);
}

function assertValid(key: string): void {
  if (!isValidRank(key)) throw new RankOrderError(`invalid rank: ${key}`);
}

/** Chave bem formada: alfabeto, cabeça coerente, sem fração terminando em `0`, ≤ 64. */
export function isValidRank(key: string): boolean {
  if (key.length === 0 || key.length > RANK_MAX_LENGTH || key === SMALLEST_INTEGER) return false;
  if ([...key].some((char) => digitOf(char) < 0)) return false;
  const head = key.charAt(0);
  if (!((head >= 'a' && head <= 'z') || (head >= 'A' && head <= 'Z'))) return false;
  const length = integerLength(head);
  if (length > key.length) return false;
  return !key.slice(length).endsWith('0');
}

/** Dígitos estritamente entre `a` e `b` (frações; `b === null` = sem teto). */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new RankOrderError(`${a} >= ${b}`);
  if (b !== null) {
    let common = 0;
    while ((a.charAt(common) || '0') === b.charAt(common)) common += 1;
    if (common > 0) return b.slice(0, common) + midpoint(a.slice(common), b.slice(common));
  }
  const low = a ? digitOf(a.charAt(0)) : 0;
  const high = b !== null ? digitOf(b.charAt(0)) : DIGITS.length;
  if (high - low > 1) return DIGITS.charAt(Math.round((low + high) / 2));
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(low) + midpoint(a.slice(1), null);
}

function incrementInteger(value: string): string | null {
  const [head = '', ...digits] = value;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const next = digitOf(digits[index]) + 1;
    if (next < DIGITS.length) {
      digits[index] = DIGITS.charAt(next);
      return head + digits.join('');
    }
    digits[index] = '0';
  }
  // Estouro: a parte inteira ganha um dígito (ou cruza de negativo para positivo).
  if (head === 'Z') return FIRST_RANK;
  if (head === 'z') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push('0');
  else digits.pop();
  return nextHead + digits.join('');
}

function decrementInteger(value: string): string | null {
  const [head = '', ...digits] = value;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const previous = digitOf(digits[index]) - 1;
    if (previous >= 0) {
      digits[index] = DIGITS.charAt(previous);
      return head + digits.join('');
    }
    digits[index] = LAST_DIGIT;
  }
  if (head === 'a') return `Z${LAST_DIGIT}`;
  if (head === 'A') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (nextHead < 'Z') digits.push(LAST_DIGIT);
  else digits.pop();
  return nextHead + digits.join('');
}

/**
 * Chave estritamente entre `a` e `b` (`null` = início ou fim da coluna). Exige `a < b`: chaves
 * empatadas são resolvidas por quem chama (rebalanceamento), nunca aqui.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) assertValid(a);
  if (b !== null) assertValid(b);
  if (a !== null && b !== null && a >= b) throw new RankOrderError(`${a} >= ${b}`);
  if (a === null) {
    if (b === null) return FIRST_RANK;
    const integerB = integerPart(b);
    const fractionB = b.slice(integerB.length);
    if (integerB === SMALLEST_INTEGER) return integerB + midpoint('', fractionB);
    if (integerB < b) return integerB;
    const decremented = decrementInteger(integerB);
    if (decremented === null) throw new RankOrderError('cannot go before the smallest rank');
    return decremented;
  }
  if (b === null) {
    const integerA = integerPart(a);
    const incremented = incrementInteger(integerA);
    return incremented ?? integerA + midpoint(a.slice(integerA.length), null);
  }
  const integerA = integerPart(a);
  const integerB = integerPart(b);
  if (integerA === integerB) {
    return integerA + midpoint(a.slice(integerA.length), b.slice(integerB.length));
  }
  const incremented = incrementInteger(integerA);
  if (incremented === null) throw new RankOrderError('cannot increment the largest rank');
  if (incremented < b) return incremented;
  return integerA + midpoint(a.slice(integerA.length), null);
}

/** Depois de `a` (fim da coluna): crescimento logarítmico em acréscimos seguidos. */
export const keyAfter = (a: string | null) => keyBetween(a, null);

/** Antes de `b` (topo da coluna): crescimento logarítmico em inserções seguidas no topo. */
export const keyBefore = (b: string | null) => keyBetween(null, b);

/** `count` chaves crescentes e curtas, para rebalancear uma coluna sem mudar a ordem. */
export function spreadKeys(count: number): string[] {
  const keys: string[] = [];
  let last: string | null = null;
  for (let index = 0; index < count; index += 1) {
    last = keyAfter(last);
    keys.push(last);
  }
  return keys;
}

/** A chave ficou longa demais: o movimento rebalanceia a coluna antes de gravar. */
export const needsRebalance = (key: string) => key.length > RANK_REBALANCE_LENGTH;
