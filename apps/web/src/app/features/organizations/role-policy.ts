import type { OrganizationRole } from '@taskflow/contracts';

// Espelho da BR-021 só para a interface esconder o que a API negaria. A decisão é sempre do
// servidor, sobre o estado relido sob lock (design da spec 002).

const ROLES: ReadonlyArray<OrganizationRole> = ['owner', 'admin', 'member', 'viewer'];

/** Papéis para os quais o ator pode levar o alvo (inclui o atual, para o seletor). */
export function assignableRoles(input: {
  readonly actor: OrganizationRole;
  readonly target: OrganizationRole;
  readonly isSelf: boolean;
}): ReadonlyArray<OrganizationRole> {
  const { actor, target, isSelf } = input;
  if (isSelf) return actor === 'owner' ? ROLES : [target];
  if (actor === 'owner') return ROLES;
  if (actor === 'admin' && target !== 'owner') return ROLES.filter((role) => role !== 'owner');
  return [target];
}

export function canRemoveMember(input: {
  readonly actor: OrganizationRole;
  readonly target: OrganizationRole;
  readonly isSelf: boolean;
}): boolean {
  const { actor, target, isSelf } = input;
  if (isSelf) return false; // sair tem botão próprio
  return actor === 'owner' || (actor === 'admin' && target !== 'owner');
}
