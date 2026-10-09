/** Papéis organizacionais (linguagem publicada; matriz em `docs/security/authorization.md`). */
export const ORGANIZATION_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** Papel desconhecido nunca concede permissão: quem lê do banco ou da rede valida aqui. */
export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === 'string' && (ORGANIZATION_ROLES as ReadonlyArray<string>).includes(value);
}
