import {
  canOnProject,
  PROJECT_PERMISSIONS,
  type OrganizationRole,
  type ProjectPermission,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import { assignableProjectRoles } from '../participation/project-member';

/** BR-026: o que continua valendo num projeto arquivado (`project:archive` = restaurar). */
const ARCHIVED_CAPABILITIES: ReadonlyArray<ProjectPermission> = ['project:read', 'project:archive'];

/**
 * Capacidades do usuário num projeto (dica de interface, spec 006): permissões com grant `allow`
 * para o papel efetivo, descontado o arquivamento. Grants `own` não entram — viram ações por
 * recurso nas specs 004+. Sem papel efetivo ⇒ nenhuma (o projeto responde 404).
 */
export function projectCapabilities(
  effectiveRole: ProjectRole | null,
  state: Readonly<{ archived: boolean }>,
): ReadonlyArray<ProjectPermission> {
  return PROJECT_PERMISSIONS.filter(
    (permission) =>
      canOnProject(effectiveRole, permission, { ownsResource: false }) &&
      (!state.archived || ARCHIVED_CAPABILITIES.includes(permission)),
  );
}

export type ParticipantActions = Readonly<{
  changeRoleTo: ReadonlyArray<ProjectRole>;
  remove: boolean;
  leave: boolean;
}>;

/**
 * Ações do ator sobre um participante (spec 006, padrão de `actions`). Alterar papel: com
 * `project-member:manage`, projeto ativo, papéis dentro do teto do alvo sem o atual. Remover:
 * com `project-member:manage`, inclusive em arquivado (reduzir acesso é sempre seguro). Sair:
 * só sobre si. Dica apenas — o caso de uso decide sob lock.
 */
export function participantActions(input: {
  readonly actorEffectiveRole: ProjectRole | null;
  readonly targetRole: ProjectRole;
  readonly targetOrganizationRole: OrganizationRole;
  readonly isSelf: boolean;
  readonly archived: boolean;
}): ParticipantActions {
  const canManage = canOnProject(input.actorEffectiveRole, 'project-member:manage', {
    ownsResource: false,
  });
  return {
    changeRoleTo:
      canManage && !input.archived
        ? assignableProjectRoles(input.targetOrganizationRole).filter(
            (role) => role !== input.targetRole,
          )
        : [],
    remove: canManage && !input.isSelf,
    leave: input.isSelf,
  };
}
