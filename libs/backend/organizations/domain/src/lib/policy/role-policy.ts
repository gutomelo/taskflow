import {
  hasOrganizationPermission,
  ORGANIZATION_ROLES,
  type OrganizationRole,
} from '@taskflow/backend/shared/kernel';

/**
 * Política de papéis da organização (BR-021; matriz de `docs/security/authorization.md`).
 * Funções puras sobre o estado **relido sob lock** — o papel vindo do middleware só serve para
 * negação rápida. A regra "último owner" (BR-019) depende da contagem e fica no caso de uso.
 */

/** Convidar (e listar, reenviar, revogar): `member:invite`; o papel do convite nunca é owner. */
export function canInvite(actor: OrganizationRole, role: OrganizationRole): boolean {
  return hasOrganizationPermission(actor, 'member:invite') && role !== 'owner';
}

export function canChangeRole(input: {
  readonly actor: OrganizationRole;
  readonly target: OrganizationRole;
  readonly newRole: OrganizationRole;
  readonly isSelf: boolean;
}): boolean {
  const { actor, target, newRole, isSelf } = input;
  // Ninguém altera o próprio papel, exceto o owner que se rebaixa (último owner: BR-019).
  if (isSelf) return actor === 'owner' && target === 'owner';
  if (!hasOrganizationPermission(actor, 'member:change-role')) return false;
  if (actor === 'owner') return true;
  return target !== 'owner' && newRole !== 'owner';
}

export function canRemove(input: {
  readonly actor: OrganizationRole;
  readonly target: OrganizationRole;
  readonly isSelf: boolean;
}): boolean {
  const { actor, target, isSelf } = input;
  // Sair é sempre permitido pela política (último owner: BR-019, no caso de uso).
  if (isSelf) return true;
  if (!hasOrganizationPermission(actor, 'member:remove')) return false;
  if (actor === 'owner') return true;
  return target !== 'owner';
}

/**
 * Ações que o ator pode executar sobre um membro (capacidade de interface, spec 006): papéis
 * para os quais pode alterá-lo **sem o atual** (vazio = não pode) e se pode removê-lo (falso para
 * si — sair tem ação própria). Reflete BR-021, não BR-019: o último owner pode ver "rebaixar" e
 * receber `LAST_OWNER`. Dica apenas; a decisão é do caso de uso sob lock.
 */
export function memberActions(input: {
  readonly actor: OrganizationRole;
  readonly target: OrganizationRole;
  readonly isSelf: boolean;
}): Readonly<{ changeRoleTo: ReadonlyArray<OrganizationRole>; remove: boolean }> {
  const { actor, target, isSelf } = input;
  return {
    changeRoleTo: ORGANIZATION_ROLES.filter(
      (newRole) => newRole !== target && canChangeRole({ actor, target, newRole, isSelf }),
    ),
    remove: !isSelf && canRemove({ actor, target, isSelf }),
  };
}
