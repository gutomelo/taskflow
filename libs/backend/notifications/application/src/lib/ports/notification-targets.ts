import type { OrganizationRole } from '@taskflow/backend/shared/kernel';

export type Viewer = Readonly<{ userId: string; organizationRole: OrganizationRole }>;
export type VisibleTask = Readonly<{ key: string; title: string }>;
export type MentionReference = Readonly<{ taskId: string; commentId: string; userId: string }>;

/** Chave das menções ativas: `commentId|userId`. */
export const activeMentionKey = (commentId: string, userId: string) => `${commentId}|${userId}`;

/**
 * Porta de leitura (D3, D9): o que o leitor pode ver **agora**. Ligada no composition root a
 * `tasks` (tarefas visíveis, que consulta `projects`) e `collaboration` (menções ativas). Falha
 * fechado: erro propaga; ausência no resultado = não mostrar (B4 da revisão de segurança).
 */
export interface NotificationTargets {
  visibleTasks(
    organizationId: string,
    viewer: Viewer,
    taskIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, VisibleTask>>;
  /** Menções que ainda existem em comentário não removido da tarefa indicada (chaves `activeMentionKey`). */
  activeMentions(
    organizationId: string,
    mentions: ReadonlyArray<MentionReference>,
  ): Promise<ReadonlySet<string>>;
}
