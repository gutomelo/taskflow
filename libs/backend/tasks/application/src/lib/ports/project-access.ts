import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';
import type { Page, PageRequest, WorkflowView } from '@taskflow/backend/tasks/domain';

export type ProjectLookup = Readonly<{ projectId: string } | { key: string }>;

/** Projeto travado para uma escrita de tarefa, com os papéis relidos sob lock. */
export type LockedProject = Readonly<{
  projectId: string;
  key: string;
  archived: boolean;
  /** Lido depois do lock (obrigação para a spec 005). */
  workflow: WorkflowView;
  /** Papel efetivo de cada pessoa pedida (`null` = sem acesso ao projeto). */
  effectiveRoles: ReadonlyMap<string, ProjectRole | null>;
  /** Pessoas pedidas que ainda são membros da organização. */
  organizationMembers: ReadonlySet<string>;
}>;

/** Projeto visível ao leitor (sem lock). */
export type ReadableProject = Readonly<{
  projectId: string;
  key: string;
  archived: boolean;
  workflow: WorkflowView;
  effectiveRole: ProjectRole;
}>;

export type AssignableUser = Readonly<{
  userId: string;
  name: string | null;
  email: string | null;
  effectiveRole: ProjectRole;
}>;

/**
 * Porta para `projects` (spec 004): `tasks` nunca lê tabelas de outro contexto. Ligada no
 * composition root aos casos de uso de contribuição de `projects`, na mesma transação.
 */
export interface ProjectAccess {
  /**
   * Trava o projeto `FOR SHARE` e as memberships das pessoas `FOR SHARE` (ordem única de locks do
   * design). Só em transação. `null` se o projeto não existir na organização.
   */
  lockForContribution(
    organizationId: string,
    lookup: ProjectLookup,
    userIds: ReadonlyArray<string>,
  ): Promise<LockedProject | null>;
  /** Projeto visível ao leitor numa consulta; `null` = inexistente ou sem acesso. */
  resolveForRead(
    organizationId: string,
    lookup: ProjectLookup,
    viewer: Readonly<{ userId: string; organizationRole: OrganizationRole }>,
  ): Promise<ReadableProject | null>;
  /**
   * Spec 008: quais dos projetos dados o leitor vê agora (chave), numa consulta. Ausente = não
   * visível.
   */
  readableProjects(
    organizationId: string,
    projectIds: ReadonlyArray<string>,
    viewer: Readonly<{ userId: string; organizationRole: OrganizationRole }>,
  ): Promise<ReadonlyMap<string, Readonly<{ key: string }>>>;
  /** Quem pode ser responsável (papel efetivo manager/member), por cursor. */
  assignableUsers(
    organizationId: string,
    projectId: string,
    page: PageRequest,
  ): Promise<Page<AssignableUser>>;
}
