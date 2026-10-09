import type { OrganizationRole } from '@taskflow/backend/shared/kernel';

/**
 * Política de papéis da organização (BR-021; matriz de `docs/security/authorization.md`).
 * Funções puras sobre o estado **relido sob lock** — o papel vindo do middleware só serve para
 * negação rápida. A regra "último owner" (BR-019) depende da contagem e fica no caso de uso.
 */

const MANAGERS: ReadonlySet<OrganizationRole> = new Set(['owner', 'admin']);

/** Editar a organização, listar/gerenciar convites, alterar e remover membros (com limites). */
export function canManageMembers(actor: OrganizationRole): boolean {
  return MANAGERS.has(actor);
}

/** Convidar: owner e admin; o papel do convite nunca é owner. */
export function canInvite(actor: OrganizationRole, role: OrganizationRole): boolean {
  return MANAGERS.has(actor) && role !== 'owner';
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
  if (actor === 'owner') return true;
  if (actor === 'admin') return target !== 'owner' && newRole !== 'owner';
  return false;
}

export function canRemove(input: {
  readonly actor: OrganizationRole;
  readonly target: OrganizationRole;
  readonly isSelf: boolean;
}): boolean {
  const { actor, target, isSelf } = input;
  // Sair é sempre permitido pela política (último owner: BR-019, no caso de uso).
  if (isSelf) return true;
  if (actor === 'owner') return true;
  if (actor === 'admin') return target !== 'owner';
  return false;
}
