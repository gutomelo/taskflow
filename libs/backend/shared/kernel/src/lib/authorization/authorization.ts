import { isOrganizationRole, type OrganizationRole } from '../organization/organization-role';

// Shared Kernel de autorização (ADR 0013, spec 006): só vocabulário, matrizes e funções puras.
// Regras que dependem de estado (último owner, alvo de BR-021, BR-003, projeto arquivado) ficam
// nos contextos donos; um grant `allow` nunca é, sozinho, autorização completa.

/** Permissões de organização com comportamento implementado (itens planejados ficam de fora). */
export const ORGANIZATION_PERMISSIONS = [
  'organization:read',
  'organization:update',
  'member:invite',
  'member:change-role',
  /** Remover **outros** membros; sair da organização não é permissão (sempre permitido, BR-019). */
  'member:remove',
  'project:create',
] as const;
export type OrganizationPermission = (typeof ORGANIZATION_PERMISSIONS)[number];

export const PROJECT_PERMISSIONS = [
  'project:read',
  'project:update',
  'project:archive',
  'project-member:manage',
  'task:create',
  'task:update',
  'task:assign',
  'task:delete',
  'comment:create',
  'comment:update',
  'comment:delete',
  'sprint:manage',
  'board:configure',
] as const;
export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number];

export const PROJECT_ROLES = ['manager', 'member', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** `setting`: decidido por configuração da organização (BR-024). */
export type OrganizationGrant = 'allow' | 'deny' | 'setting';
/** `own`: só sobre recurso criado pelo próprio usuário. */
export type ProjectGrant = 'allow' | 'own' | 'deny';

export type OrganizationSettings = Readonly<{ membersCanCreateProjects: boolean }>;

// Guardas: `Object.hasOwn` sobre um índice próprio, nunca `in` nem acesso a protótipo
// (`'constructor'`, `'__proto__'` e afins são negados).
const indexOf = <T extends string>(values: ReadonlyArray<T>): Readonly<Record<string, true>> =>
  Object.freeze(Object.fromEntries(values.map((value) => [value, true] as const)));
const ORGANIZATION_PERMISSION_INDEX = indexOf(ORGANIZATION_PERMISSIONS);
const PROJECT_PERMISSION_INDEX = indexOf(PROJECT_PERMISSIONS);
const PROJECT_ROLE_INDEX = indexOf(PROJECT_ROLES);

export function isOrganizationPermission(value: unknown): value is OrganizationPermission {
  return typeof value === 'string' && Object.hasOwn(ORGANIZATION_PERMISSION_INDEX, value);
}
export function isProjectPermission(value: unknown): value is ProjectPermission {
  return typeof value === 'string' && Object.hasOwn(PROJECT_PERMISSION_INDEX, value);
}
/** Papel de projeto desconhecido (ex.: dado inconsistente no banco) nunca concede nada. */
export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && Object.hasOwn(PROJECT_ROLE_INDEX, value);
}

// Matrizes de `docs/security/authorization.md`. Tipo explícito: o compilador exige uma decisão
// para cada par papel × permissão (negação por padrão por construção).
const ORGANIZATION_MATRIX: Readonly<
  Record<OrganizationRole, Readonly<Record<OrganizationPermission, OrganizationGrant>>>
> = Object.freeze({
  owner: Object.freeze({
    'organization:read': 'allow',
    'organization:update': 'allow',
    'member:invite': 'allow',
    'member:change-role': 'allow',
    'member:remove': 'allow',
    'project:create': 'allow',
  }),
  admin: Object.freeze({
    'organization:read': 'allow',
    'organization:update': 'allow',
    'member:invite': 'allow',
    'member:change-role': 'allow',
    'member:remove': 'allow',
    'project:create': 'allow',
  }),
  member: Object.freeze({
    'organization:read': 'allow',
    'organization:update': 'deny',
    'member:invite': 'deny',
    'member:change-role': 'deny',
    'member:remove': 'deny',
    'project:create': 'setting',
  }),
  viewer: Object.freeze({
    'organization:read': 'allow',
    'organization:update': 'deny',
    'member:invite': 'deny',
    'member:change-role': 'deny',
    'member:remove': 'deny',
    'project:create': 'deny',
  }),
});

const PROJECT_MATRIX: Readonly<
  Record<ProjectRole, Readonly<Record<ProjectPermission, ProjectGrant>>>
> = Object.freeze({
  manager: Object.freeze({
    'project:read': 'allow',
    'project:update': 'allow',
    'project:archive': 'allow',
    'project-member:manage': 'allow',
    'task:create': 'allow',
    'task:update': 'allow',
    'task:assign': 'allow',
    'task:delete': 'allow',
    'comment:create': 'allow',
    'comment:update': 'own',
    'comment:delete': 'allow',
    'sprint:manage': 'allow',
    'board:configure': 'allow',
  }),
  member: Object.freeze({
    'project:read': 'allow',
    'project:update': 'deny',
    'project:archive': 'deny',
    'project-member:manage': 'deny',
    'task:create': 'allow',
    'task:update': 'allow',
    'task:assign': 'allow',
    'task:delete': 'own',
    'comment:create': 'allow',
    'comment:update': 'own',
    'comment:delete': 'own',
    'sprint:manage': 'deny',
    'board:configure': 'deny',
  }),
  viewer: Object.freeze({
    'project:read': 'allow',
    'project:update': 'deny',
    'project:archive': 'deny',
    'project-member:manage': 'deny',
    'task:create': 'deny',
    'task:update': 'deny',
    'task:assign': 'deny',
    'task:delete': 'deny',
    'comment:create': 'deny',
    'comment:update': 'deny',
    'comment:delete': 'deny',
    'sprint:manage': 'deny',
    'board:configure': 'deny',
  }),
});

/**
 * Grant do papel na organização, sem configuração: o que as negações rápidas usam. Papel ou
 * permissão desconhecidos ⇒ `deny`.
 */
export function organizationGrant(role: unknown, permission: unknown): OrganizationGrant {
  if (!isOrganizationRole(role) || !isOrganizationPermission(permission)) return 'deny';
  return ORGANIZATION_MATRIX[role][permission];
}

/** Permissões efetivas na organização, com `setting` resolvido (capacidades; spec 003). */
export function organizationPermissions(
  role: OrganizationRole,
  settings: OrganizationSettings,
): ReadonlyArray<OrganizationPermission> {
  return ORGANIZATION_PERMISSIONS.filter((permission) => {
    const grant = organizationGrant(role, permission);
    if (grant === 'setting')
      return permission === 'project:create' && settings.membersCanCreateProjects;
    return grant === 'allow';
  });
}

/** `true` só para `allow` — use quando o grant `setting` já foi resolvido em outro lugar. */
export function hasOrganizationPermission(role: unknown, permission: unknown): boolean {
  return organizationGrant(role, permission) === 'allow';
}

/**
 * Papel efetivo num projeto (BR-023): o papel da organização é teto. `null` = sem acesso (404).
 * Papel de projeto desconhecido (dado inconsistente no banco) conta como sem participação.
 */
export function effectiveProjectRole(
  organizationRole: OrganizationRole,
  projectRole: unknown,
): ProjectRole | null {
  const participation = isProjectRole(projectRole) ? projectRole : null;
  switch (organizationRole) {
    case 'owner':
    case 'admin':
      return 'manager';
    case 'member':
      return participation;
    case 'viewer':
      return participation === null ? null : 'viewer';
    default: {
      const unreachable: never = organizationRole;
      return unreachable;
    }
  }
}

export function projectGrant(role: unknown, permission: unknown): ProjectGrant {
  if (!isProjectRole(role) || !isProjectPermission(permission)) return 'deny';
  return PROJECT_MATRIX[role][permission];
}

/**
 * Decisão de papel no projeto. `ownsResource` é obrigatório e calculado pelo contexto dono sobre o
 * recurso carregado (`createdBy === actor.userId`); `own` sem ser dono ⇒ negado.
 */
export function canOnProject(
  role: ProjectRole | null,
  permission: ProjectPermission,
  options: Readonly<{ ownsResource: boolean }>,
): boolean {
  const grant = projectGrant(role, permission);
  return grant === 'allow' || (grant === 'own' && options.ownsResource === true);
}
