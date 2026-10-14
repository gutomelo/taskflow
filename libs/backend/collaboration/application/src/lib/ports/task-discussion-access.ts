import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';

/** Tarefa travada para uma escrita de comentário, com os papéis relidos sob lock. */
export type DiscussionLock = Readonly<{
  taskId: string;
  projectId: string;
  archived: boolean;
  canceled: boolean;
  /** Papel efetivo de cada pessoa pedida; `null` = não lê o projeto. */
  effectiveRoles: ReadonlyMap<string, ProjectRole | null>;
}>;

/** Tarefa visível ao leitor (sem lock). */
export type DiscussionTask = Readonly<{
  taskId: string;
  projectId: string;
  archived: boolean;
  canceled: boolean;
  effectiveRole: ProjectRole;
}>;

export type MentionCandidate = Readonly<{ userId: string; name: string; email: string }>;

export type MentionCandidatePage = Readonly<{
  items: ReadonlyArray<MentionCandidate>;
  nextCursor: string | null;
}>;

/**
 * Porta única de `collaboration` (D8 do design da spec 010): `collaboration` nunca lê tabelas de
 * outros contextos. Ligada no composition root a `tasks` (tarefa e lock), `projects` (quem lê o
 * projeto) e `identity` (busca). Devolve dados; quem decide 404/403/estado é `collaboration`.
 */
export interface TaskDiscussionAccess {
  /**
   * Projeto e memberships das pessoas `FOR SHARE` e a linha da tarefa `FOR SHARE` (ordem única de
   * locks). Só em transação. `null` = tarefa inexistente ou de outra organização.
   */
  lockForComment(
    organizationId: string,
    taskId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<DiscussionLock | null>;
  /** `null` = tarefa inexistente, de outra organização ou de projeto sem leitura. */
  resolveForRead(
    organizationId: string,
    taskId: string,
    viewer: Readonly<{ userId: string; organizationRole: OrganizationRole }>,
  ): Promise<DiscussionTask | null>;
  /**
   * Quem lê o projeto, filtrado por nome ou e-mail e sem `excludeUserId`, por cursor opaco.
   * `null` = leitores demais para buscar (teto de `projects`).
   */
  mentionCandidates(
    organizationId: string,
    projectId: string,
    search: Readonly<{
      query: string;
      excludeUserId: string;
      limit: number;
      cursor: string | null;
    }>,
  ): Promise<MentionCandidatePage | null>;
}
