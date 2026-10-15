/** BR-022: formato do slug (palavras reservadas só no servidor). */
export const SLUG_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

/**
 * Sugestão de slug a partir do nome (RF-01): sem acentos, minúsculas, hífens entre palavras,
 * começando por letra. É só sugestão — o valor enviado precisa obedecer ao formato.
 */
export function suggestSlug(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, SLUG_MAX_LENGTH);
  return base.replace(/-+$/, '');
}

export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= SLUG_MIN_LENGTH && slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug)
  );
}
