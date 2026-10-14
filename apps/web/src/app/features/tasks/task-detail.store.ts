import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import type { TaskDto, TaskSummary, WorkflowDto } from '@taskflow/contracts';
import { toApiProblem, type ApiProblem } from '../../core/http/api-problem';
import { isProblemDetails } from '../../core/http/contract-guards';
import { ActiveOrganizationStore } from '../../core/organizations';
import { commonErrorMessage, formMessages } from '../../shared/forms/form.messages';
import { codeMessage } from '../organizations/organizations.messages';
import { ActiveProjectStore } from '../projects/active-project.store';
import { ProjectApi } from '../projects/project-api';
import { TaskApi } from './task-api';
import { taskDetailMessages } from './tasks.messages';

type Status = 'loading' | 'loaded' | 'not-found' | 'error';

/** Estado de navegação: a lista de tarefas anuncia a exclusão (valor = chave excluída). */
export const TASK_DELETED_STATE = 'taskDeleted';

const isTaskNotFound = (error: unknown) =>
  error instanceof HttpErrorResponse &&
  error.status === 404 &&
  isProblemDetails(error.error) &&
  error.error.code === 'TASK_NOT_FOUND';

/**
 * Tarefa aberta em `/o/:slug/projects/:key/tasks/:number` (RF-04, RF-13). Toda mutação substitui a
 * tarefa pela resposta da API (versão e ações novas); conflito de versão recarrega e avisa.
 */
@Injectable()
export class TaskDetailStore {
  private readonly api = inject(TaskApi);
  private readonly projects = inject(ProjectApi);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly project = inject(ActiveProjectStore);
  private readonly state = signal<{ status: Status; task: TaskDto | null; key: string }>({
    status: 'loading',
    task: null,
    key: '',
  });
  private readonly workflowState = signal<WorkflowDto | null>(null);

  readonly status = computed(() => this.state().status);
  readonly task = computed(() => this.state().task);
  readonly workflow = this.workflowState.asReadonly();
  /** Mensagem de erro da última ação (alerta) e de sucesso (anúncio `aria-live`). */
  readonly error = signal<string | null>(null);
  readonly announcement = signal('');
  readonly busy = signal(false);
  /** Código do último erro de ação (`null` depois de um sucesso). */
  readonly lastErrorCode = signal<string | null>(null);

  /** Nome do status pelo workflow (o detalhe só traz os ids dos destinos). */
  statusName(statusId: string): string {
    return this.workflowState()?.statuses.find((status) => status.id === statusId)?.name ?? '';
  }

  async load(key: string): Promise<void> {
    this.state.set({ status: 'loading', task: null, key });
    try {
      const organizationId = this.organization.requireId();
      const [task, workflow] = await Promise.all([
        this.api.getByKey(organizationId, key),
        this.projects.workflow(organizationId, this.project.requireId()),
      ]);
      this.workflowState.set(workflow);
      this.state.set({ status: 'loaded', task, key });
    } catch (error) {
      if (this.project.handle(error)) return;
      this.state.update((state) => ({
        ...state,
        status: isTaskNotFound(error) ? 'not-found' : 'error',
      }));
    }
  }

  requireTask(): TaskDto {
    const task = this.state().task;
    if (!task) throw new Error('No task loaded');
    return task;
  }

  /**
   * Roda uma mutação: substitui a tarefa pela resposta e anuncia `success`. Em erro, mostra a
   * mensagem pelo código (422 de BR-001/BR-006 com as chaves das tarefas) e recarrega quando os
   * dados ficaram velhos. Devolve se deu certo.
   */
  async run(
    action: (organizationId: string, task: TaskDto) => Promise<TaskDto | void>,
    success: string | ((task: TaskDto) => string),
  ): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set(null);
    this.lastErrorCode.set(null);
    try {
      const result = await action(this.organization.requireId(), this.requireTask());
      if (result) this.state.update((state) => ({ ...state, task: result }));
      this.announcement.set(typeof success === 'string' ? success : success(this.requireTask()));
      return true;
    } catch (error) {
      if (this.project.handle(error)) return false;
      const problem = toApiProblem(error);
      this.lastErrorCode.set(problem.code);
      this.error.set(this.messageFor(problem));
      // Dados velhos: recarrega. Um 404 de tarefa pode ser de outra (ex.: bloqueadora excluída):
      // só a recarga diz se foi a tarefa aberta que sumiu.
      if (['VERSION_CONFLICT', 'TASK_CANCELED', 'TASK_NOT_FOUND'].includes(problem.code ?? '')) {
        await this.refresh();
      }
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** Recarrega sem passar por "carregando" (a mensagem de erro continua visível). */
  async refresh(): Promise<void> {
    try {
      const task = await this.api.getByKey(this.organization.requireId(), this.state().key);
      this.state.update((state) => ({ ...state, task }));
    } catch (error) {
      if (this.project.handle(error)) return;
      if (isTaskNotFound(error)) this.state.update((state) => ({ ...state, status: 'not-found' }));
    }
  }

  private messageFor(problem: ApiProblem): string {
    const m = taskDetailMessages;
    const keys = this.keysOf(problem.taskIds);
    if (problem.code === 'TASK_HAS_PENDING_REQUIRED_SUBTASKS') return m.pendingSubtasks(keys);
    if (problem.code === 'TASK_BLOCKED_BY_DEPENDENCIES') return m.pendingBlockers(keys);
    return (
      commonErrorMessage(problem) ??
      codeMessage(m.errors, problem.code) ??
      formMessages.errors.unexpected
    );
  }

  /** Os ids do 422 são de tarefas do mesmo projeto, já presentes no detalhe (subtarefas ou bloqueadoras). */
  private keysOf(taskIds: ReadonlyArray<string>): string {
    const task = this.state().task;
    const known: ReadonlyArray<TaskSummary> = task ? [...task.subtasks, ...task.blockedBy] : [];
    return taskIds.map((id) => known.find((item) => item.id === id)?.key ?? id).join(', ');
  }
}
