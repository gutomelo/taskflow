/** BR-025: 2 a 10 letras maiúsculas sem acento e dígitos, começando por letra. */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
export const PROJECT_KEY_MAX_LENGTH = 10;

const lettersAndDigits = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ');

/**
 * Sugestão de chave a partir do nome: iniciais das palavras ("Portal do Cliente" → "PDC") ou, com
 * uma palavra só, as três primeiras letras ("Website" → "WEB"). Só sugestão: o usuário edita e o
 * servidor valida o formato.
 */
export function suggestProjectKey(name: string): string {
  const words = lettersAndDigits(name).split(' ').filter(Boolean);
  const joined = words.join('').replace(/^[0-9]+/, '');
  const initials = words
    .map((word) => word[0] ?? '')
    .join('')
    .replace(/^[0-9]+/, '');
  const candidate = words.length >= 2 && initials.length >= 2 ? initials : joined.slice(0, 3);
  return candidate.slice(0, PROJECT_KEY_MAX_LENGTH);
}

export function isValidProjectKey(key: string): boolean {
  return PROJECT_KEY_PATTERN.test(key);
}

/** O que o usuário digita vira maiúsculas sem acento (a API não normaliza silenciosamente). */
export function normalizeTypedKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, PROJECT_KEY_MAX_LENGTH);
}
