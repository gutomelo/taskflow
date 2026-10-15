// Cenário comum dos testes de casos de uso de `tasks`. Nunca em produção.
import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';
import { findStatus, Task } from '@taskflow/backend/tasks/domain';
import { createTasksTestbed, type TasksTestbed } from './tasks-fakes';

export const ORG = 'org-a';
export const OTHER_ORG = 'org-b';
export const WEB = 'p-web';
export const APP = 'p-app';
export const B_WEB = 'p-b-web';

/**
 * Organização A: ana owner, adm admin, mia member (manager em WEB), bia member (member em WEB e
 * APP), vivi viewer (viewer em WEB), otto member sem participação. Organização B: projeto com a
 * mesma chave WEB e zoe owner (bia também é member de B).
 */
const PEOPLE: ReadonlyArray<
  readonly [string, OrganizationRole, ReadonlyArray<readonly [string, ProjectRole]>]
> = [
  ['ana', 'owner', []],
  ['adm', 'admin', []],
  ['mia', 'member', [[WEB, 'manager']]],
  [
    'bia',
    'member',
    [
      [WEB, 'member'],
      [APP, 'member'],
    ],
  ],
  ['vivi', 'viewer', [[WEB, 'viewer']]],
  ['otto', 'member', []],
];

export function createTasksWorld() {
  const bed = createTasksTestbed();
  const access = bed.projectAccess;
  const web = access.addProject({ organizationId: ORG, projectId: WEB, key: 'WEB' });
  const app = access.addProject({ organizationId: ORG, projectId: APP, key: 'APP' });
  const bWeb = access.addProject({ organizationId: OTHER_ORG, projectId: B_WEB, key: 'WEB' });
  for (const [userId, role, participations] of PEOPLE) {
    access.setMember(ORG, userId, role);
    for (const [projectId, projectRole] of participations) {
      access.projectById(projectId).participations.set(userId, projectRole);
    }
  }
  access.setMember(OTHER_ORG, 'zoe', 'owner');
  access.setMember(OTHER_ORG, 'bia', 'member');
  bWeb.participations.set('bia', 'member');
  return { bed, web, app, bWeb };
}

export function as(
  userId: string,
  organizationRole: OrganizationRole = roleIn(ORG, userId),
  organizationId = ORG,
): TenantRequestContext {
  return {
    requestId: 'req-1',
    actor: { userId, sessionId: `s-${userId}` },
    tenant: { organizationId, organizationRole },
  };
}

function roleIn(organizationId: string, userId: string): OrganizationRole {
  return PEOPLE.find(([id]) => id === userId)?.[1] ?? 'member';
}

/** Leva a tarefa direto a um status (sem passar pelo workflow), para montar cenários. */
export function forceStatus(bed: TasksTestbed, taskId: string, statusId: string) {
  const at = bed.tasks.rows.findIndex((row) => row.id === taskId);
  const row = bed.tasks.rows[at];
  if (!row) throw new Error(`unknown task ${taskId}`);
  const status = findStatus(bed.projectAccess.projectById(row.projectId).workflow, statusId);
  if (!status) throw new Error(`unknown status ${statusId}`);
  const task = Task.restore(row);
  task.moveTo(status, row.createdByUserId, new Date(row.updatedAt));
  bed.tasks.rows[at] = task.toSnapshot();
}

/** Cancela direto no fake (para montar cenários). */
export function forceCancel(bed: TasksTestbed, taskId: string) {
  const at = bed.tasks.rows.findIndex((row) => row.id === taskId);
  const row = bed.tasks.rows[at];
  if (!row) throw new Error(`unknown task ${taskId}`);
  const task = Task.restore(row);
  task.cancel(row.createdByUserId, new Date(row.updatedAt));
  bed.tasks.rows[at] = task.toSnapshot();
}
