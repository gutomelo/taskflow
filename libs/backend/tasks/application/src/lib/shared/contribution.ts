import type { ProjectRole } from '@taskflow/backend/shared/kernel';

/** BR-003: pode contribuir (e ser responsável) com papel efetivo manager ou member. */
export function isContributor(role: ProjectRole | null | undefined): boolean {
  return role === 'manager' || role === 'member';
}
