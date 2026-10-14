import type { Clock } from '@taskflow/backend/shared/kernel';
import type { TaskRepository } from '@taskflow/backend/tasks/domain';

export type AccessLoss = Readonly<{
  organizationId: string;
  userId: string;
  scope: Readonly<{ projectId: string }> | 'organization';
  stillContributorIn: ReadonlyArray<string>;
}>;

/**
 * BR-003 (spec 004): desfaz as atribuições de quem deixou de poder contribuir — decisão tomada em
 * `projects` (porta `ProjectContributorChanges`), aqui só executada, **na transação do chamador**.
 * Ignora BR-026/BR-029 (reduzir acesso é sempre permitido) e incrementa a versão das tarefas
 * (BR-008). Sem evento próprio: a transação é de outro contexto; o evento de quem originou é a
 * evidência (ADR 0015, item 4).
 */
export class RevokeAssignmentsOnAccessLossUseCase {
  constructor(private readonly deps: { readonly tasks: TaskRepository; readonly clock: Clock }) {}

  async execute(loss: AccessLoss): Promise<number> {
    const now = this.deps.clock.now();
    if (loss.scope === 'organization') {
      return this.deps.tasks.revokeAssignments(
        loss.organizationId,
        loss.userId,
        { kind: 'organization', exceptProjectIds: loss.stillContributorIn },
        now,
      );
    }
    if (loss.stillContributorIn.includes(loss.scope.projectId)) return 0;
    return this.deps.tasks.revokeAssignments(
      loss.organizationId,
      loss.userId,
      { kind: 'project', projectId: loss.scope.projectId },
      now,
    );
  }
}
