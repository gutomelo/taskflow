import type { ProjectRole } from '@taskflow/backend/shared/kernel';

/** Pode contribuir (criar, editar, ser responsável — BR-003): papel efetivo manager ou member. */
export function isContributor(role: ProjectRole | null): boolean {
  return role === 'manager' || role === 'member';
}
