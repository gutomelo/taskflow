import { InvalidSlugError } from '../errors';

/** 3–40: começa por letra; letras minúsculas, dígitos e hífens isolados; não termina em hífen. */
const SLUG_FORMAT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MIN_LENGTH = 3;
const MAX_LENGTH = 40;

/**
 * Reservados contra impersonação (BR-022): a organização vive sob `/o/:slug`, então não há
 * colisão de rotas — o risco é parecer canal oficial.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'api',
  'billing',
  'help',
  'official',
  'root',
  'security',
  'staff',
  'support',
  'system',
  'taskflow',
]);

/** Identificador público da organização na URL do app. Único (no banco) e imutável (BR-022). */
export class OrganizationSlug {
  private constructor(readonly value: string) {}

  /** Sem normalização: o valor enviado precisa obedecer ao formato (a sugestão fica no cliente). */
  static create(raw: string): OrganizationSlug {
    if (
      raw.length < MIN_LENGTH ||
      raw.length > MAX_LENGTH ||
      !SLUG_FORMAT.test(raw) ||
      RESERVED_SLUGS.has(raw)
    ) {
      throw new InvalidSlugError();
    }
    return new OrganizationSlug(raw);
  }

  toString(): string {
    return this.value;
  }
}
