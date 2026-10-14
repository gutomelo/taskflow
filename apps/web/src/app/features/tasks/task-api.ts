import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  AssignableUserPage,
  CreateTaskRequest,
  TaskDto,
  TaskPage,
  TaskPriority,
  UpdateTaskRequest,
} from '@taskflow/contracts';
import { ContractViolationError } from '../../core/http/contract-guards';
import { tenantUrl } from '../../core/organizations';
import { isAssignableUserPage, isTask, isTaskPage } from './tasks-contract-guards';

function checked<T>(body: unknown, guard: (value: unknown) => value is T, endpoint: string): T {
  if (!guard(body)) throw new ContractViolationError(endpoint);
  return body;
}

/** Filtros da lista (RF-03); "eu" e "sem responsável" ficam em `assigned`, nunca no UUID. */
export type TaskFilters = Readonly<{
  statusId: string | null;
  assigned: 'me' | 'none' | null;
  priority: TaskPriority | null;
  canceled: boolean;
}>;

type Versioned = Pick<TaskDto, 'id' | 'version'>;

/**
 * Tarefas da organização ativa (spec 004). Toda chamada recebe o id explícito da organização
 * resolvida em `/o/:slug` (ADR 0012); o projeto vai na query ou no corpo.
 */
@Injectable({ providedIn: 'root' })
export class TaskApi {
  private readonly http = inject(HttpClient);

  async list(
    organizationId: string,
    projectId: string,
    filters: TaskFilters,
    cursor: string | null,
  ): Promise<TaskPage> {
    const url = tenantUrl(organizationId, '/tasks');
    let params = new HttpParams().set('projectId', projectId);
    if (filters.statusId) params = params.set('statusId', filters.statusId);
    if (filters.assigned) params = params.set('assigned', filters.assigned);
    if (filters.priority) params = params.set('priority', filters.priority);
    if (filters.canceled) params = params.set('canceled', 'true');
    if (cursor) params = params.set('cursor', cursor);
    return checked(await firstValueFrom(this.http.get<unknown>(url, { params })), isTaskPage, url);
  }

  async create(organizationId: string, request: CreateTaskRequest): Promise<TaskDto> {
    const url = tenantUrl(organizationId, '/tasks');
    return checked(await firstValueFrom(this.http.post<unknown>(url, request)), isTask, url);
  }

  async getByKey(organizationId: string, key: string): Promise<TaskDto> {
    const url = tenantUrl(organizationId, `/tasks/by-key/${encodeURIComponent(key)}`);
    return checked(await firstValueFrom(this.http.get<unknown>(url)), isTask, url);
  }

  async update(
    organizationId: string,
    taskId: string,
    request: UpdateTaskRequest,
  ): Promise<TaskDto> {
    const url = this.taskUrl(organizationId, taskId);
    return checked(await firstValueFrom(this.http.patch<unknown>(url, request)), isTask, url);
  }

  async assign(
    organizationId: string,
    task: Versioned,
    assigneeUserId: string | null,
  ): Promise<TaskDto> {
    const url = `${this.taskUrl(organizationId, task.id)}/assignee`;
    const body = { assigneeUserId, version: task.version };
    return checked(await firstValueFrom(this.http.put<unknown>(url, body)), isTask, url);
  }

  async transition(organizationId: string, task: Versioned, statusId: string): Promise<TaskDto> {
    const url = `${this.taskUrl(organizationId, task.id)}/transition`;
    const body = { statusId, version: task.version };
    return checked(await firstValueFrom(this.http.post<unknown>(url, body)), isTask, url);
  }

  /** Cancelar ou reabrir (BR-029), com a versão (BR-008). */
  async setCanceled(organizationId: string, task: Versioned, canceled: boolean): Promise<TaskDto> {
    const url = `${this.taskUrl(organizationId, task.id)}/${canceled ? 'cancel' : 'reopen'}`;
    const body = await firstValueFrom(this.http.post<unknown>(url, { version: task.version }));
    return checked(body, isTask, url);
  }

  remove(organizationId: string, task: Versioned): Promise<void> {
    const params = new HttpParams().set('version', task.version);
    return firstValueFrom(
      this.http.delete<void>(this.taskUrl(organizationId, task.id), { params }),
    );
  }

  async addDependency(
    organizationId: string,
    taskId: string,
    blockingTaskId: string,
  ): Promise<TaskDto> {
    const url = `${this.taskUrl(organizationId, taskId)}/dependencies`;
    const body = await firstValueFrom(this.http.post<unknown>(url, { blockingTaskId }));
    return checked(body, isTask, url);
  }

  removeDependency(organizationId: string, taskId: string, blockingTaskId: string): Promise<void> {
    const url = `${this.taskUrl(organizationId, taskId)}/dependencies/${encodeURIComponent(blockingTaskId)}`;
    return firstValueFrom(this.http.delete<void>(url));
  }

  async assignableUsers(
    organizationId: string,
    projectId: string,
    cursor: string | null,
  ): Promise<AssignableUserPage> {
    const url = tenantUrl(organizationId, '/tasks/assignable-users');
    let params = new HttpParams().set('projectId', projectId);
    if (cursor) params = params.set('cursor', cursor);
    const body = await firstValueFrom(this.http.get<unknown>(url, { params }));
    return checked(body, isAssignableUserPage, url);
  }

  private taskUrl(organizationId: string, taskId: string): string {
    return tenantUrl(organizationId, `/tasks/${encodeURIComponent(taskId)}`);
  }
}
