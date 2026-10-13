import type { SecurityEventRecorder } from '@taskflow/backend/shared/application';
import type { ProjectRole } from '@taskflow/backend/shared/kernel';

type Base = Readonly<{
  requestId: string;
  organizationId: string;
  actorUserId: string;
  projectId: string;
}>;

/**
 * Eventos de segurança de `projects` (BR-007 com o desvio da spec 002): só ids, registrados
 * depois do commit do próprio caso de uso. O rebaixamento propagado não tem evento aqui (roda
 * na transação de `organizations`, que conta as participações no seu evento).
 */
export type ProjectsSecurityEvent =
  | (Base &
      Readonly<{
        type: 'projects.created' | 'projects.updated' | 'projects.archived' | 'projects.restored';
      }>)
  | (Base & Readonly<{ type: 'projects.member_added'; targetUserId: string; role: ProjectRole }>)
  | (Base &
      Readonly<{
        type: 'projects.member_role_changed';
        targetUserId: string;
        fromRole: ProjectRole;
        toRole: ProjectRole;
      }>)
  | (Base & Readonly<{ type: 'projects.member_removed'; targetUserId: string; self: boolean }>);

export type ProjectsSecurityEventRecorder = SecurityEventRecorder<ProjectsSecurityEvent>;
