import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  CreateProjectRequest,
  CreateStatusRequest,
  ReorderStatusesRequest,
  ReplaceTransitionsRequest,
  UpdateStatusRequest,
  MemberCandidatePage,
  ProjectDto,
  ProjectMemberDto,
  ProjectMemberPage,
  ProjectPage,
  ProjectRole,
  UpdateProjectRequest,
  WorkflowDto,
} from '@taskflow/contracts';
import { ContractViolationError } from '../../core/http/contract-guards';
import { tenantUrl } from '../../core/organizations';
import {
  isMemberCandidatePage,
  isProject,
  isProjectMember,
  isProjectMemberPage,
  isProjectPage,
  isWorkflow,
} from './projects-contract-guards';

function checked<T>(body: unknown, guard: (value: unknown) => value is T, endpoint: string): T {
  if (!guard(body)) throw new ContractViolationError(endpoint);
  return body;
}

const page = (cursor: string | null) =>
  cursor ? new HttpParams().set('cursor', cursor) : new HttpParams();

/**
 * Projetos da organização ativa (spec 003). Toda chamada recebe o id explícito da organização
 * resolvida em `/o/:slug` — nunca um tenant implícito (ADR 0012).
 */
@Injectable({ providedIn: 'root' })
export class ProjectApi {
  private readonly http = inject(HttpClient);

  async list(
    organizationId: string,
    options: Readonly<{ archived: boolean; cursor: string | null }>,
  ): Promise<ProjectPage> {
    const url = tenantUrl(organizationId, '/projects');
    const params = page(options.cursor).set('status', options.archived ? 'archived' : 'active');
    return checked(
      await firstValueFrom(this.http.get<unknown>(url, { params })),
      isProjectPage,
      url,
    );
  }

  async create(organizationId: string, request: CreateProjectRequest): Promise<ProjectDto> {
    const url = tenantUrl(organizationId, '/projects');
    return checked(await firstValueFrom(this.http.post<unknown>(url, request)), isProject, url);
  }

  async getByKey(organizationId: string, key: string): Promise<ProjectDto> {
    const url = tenantUrl(organizationId, `/projects/by-key/${encodeURIComponent(key)}`);
    return checked(await firstValueFrom(this.http.get<unknown>(url)), isProject, url);
  }

  async update(
    organizationId: string,
    projectId: string,
    request: UpdateProjectRequest,
  ): Promise<ProjectDto> {
    const url = tenantUrl(organizationId, `/projects/${encodeURIComponent(projectId)}`);
    return checked(await firstValueFrom(this.http.patch<unknown>(url, request)), isProject, url);
  }

  /** Arquivar ou restaurar (BR-026), com a versão (BR-008). */
  async setArchived(
    organizationId: string,
    project: Pick<ProjectDto, 'id' | 'version'>,
    archived: boolean,
  ): Promise<ProjectDto> {
    const action = archived ? 'archive' : 'restore';
    const url = tenantUrl(organizationId, `/projects/${encodeURIComponent(project.id)}/${action}`);
    const body = await firstValueFrom(this.http.post<unknown>(url, { version: project.version }));
    return checked(body, isProject, url);
  }

  async workflow(organizationId: string, projectId: string): Promise<WorkflowDto> {
    const url = tenantUrl(organizationId, `/projects/${encodeURIComponent(projectId)}/workflow`);
    return checked(await firstValueFrom(this.http.get<unknown>(url)), isWorkflow, url);
  }

  // --- Workflow configurável (spec 005, BR-030): toda edição informa a versão do workflow ---

  async createStatus(
    organizationId: string,
    projectId: string,
    request: CreateStatusRequest,
  ): Promise<WorkflowDto> {
    const url = this.workflowUrl(organizationId, projectId, '/statuses');
    return checked(await firstValueFrom(this.http.post<unknown>(url, request)), isWorkflow, url);
  }

  async updateStatus(
    organizationId: string,
    projectId: string,
    statusId: string,
    request: UpdateStatusRequest,
  ): Promise<WorkflowDto> {
    const url = this.workflowUrl(
      organizationId,
      projectId,
      `/statuses/${encodeURIComponent(statusId)}`,
    );
    return checked(await firstValueFrom(this.http.patch<unknown>(url, request)), isWorkflow, url);
  }

  async removeStatus(
    organizationId: string,
    projectId: string,
    statusId: string,
    options: Readonly<{ version: number; moveTasksToStatusId: string | null }>,
  ): Promise<WorkflowDto> {
    const url = this.workflowUrl(
      organizationId,
      projectId,
      `/statuses/${encodeURIComponent(statusId)}`,
    );
    let params = new HttpParams().set('version', options.version);
    if (options.moveTasksToStatusId)
      params = params.set('moveTasksToStatusId', options.moveTasksToStatusId);
    return checked(
      await firstValueFrom(this.http.delete<unknown>(url, { params })),
      isWorkflow,
      url,
    );
  }

  async reorderStatuses(
    organizationId: string,
    projectId: string,
    request: ReorderStatusesRequest,
  ): Promise<WorkflowDto> {
    const url = this.workflowUrl(organizationId, projectId, '/order');
    return checked(await firstValueFrom(this.http.put<unknown>(url, request)), isWorkflow, url);
  }

  async replaceTransitions(
    organizationId: string,
    projectId: string,
    request: ReplaceTransitionsRequest,
  ): Promise<WorkflowDto> {
    const url = this.workflowUrl(organizationId, projectId, '/transitions');
    return checked(await firstValueFrom(this.http.put<unknown>(url, request)), isWorkflow, url);
  }

  private workflowUrl(organizationId: string, projectId: string, suffix: string): string {
    return tenantUrl(
      organizationId,
      `/projects/${encodeURIComponent(projectId)}/workflow${suffix}`,
    );
  }

  async members(
    organizationId: string,
    projectId: string,
    cursor: string | null,
  ): Promise<ProjectMemberPage> {
    const url = tenantUrl(organizationId, `/projects/${encodeURIComponent(projectId)}/members`);
    const body = await firstValueFrom(this.http.get<unknown>(url, { params: page(cursor) }));
    return checked(body, isProjectMemberPage, url);
  }

  async candidates(
    organizationId: string,
    projectId: string,
    cursor: string | null,
  ): Promise<MemberCandidatePage> {
    const url = tenantUrl(
      organizationId,
      `/projects/${encodeURIComponent(projectId)}/member-candidates`,
    );
    const body = await firstValueFrom(this.http.get<unknown>(url, { params: page(cursor) }));
    return checked(body, isMemberCandidatePage, url);
  }

  async addMember(
    organizationId: string,
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<ProjectMemberDto> {
    const url = tenantUrl(organizationId, `/projects/${encodeURIComponent(projectId)}/members`);
    const body = await firstValueFrom(this.http.post<unknown>(url, { userId, role }));
    return checked(body, isProjectMember, url);
  }

  async changeRole(
    organizationId: string,
    projectId: string,
    member: Pick<ProjectMemberDto, 'userId' | 'version'>,
    role: ProjectRole,
  ): Promise<ProjectMemberDto> {
    const url = tenantUrl(
      organizationId,
      `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(member.userId)}`,
    );
    const body = await firstValueFrom(
      this.http.patch<unknown>(url, { role, version: member.version }),
    );
    return checked(body, isProjectMember, url);
  }

  /** Remove o participante; o próprio usuário = sair do projeto. */
  removeMember(
    organizationId: string,
    projectId: string,
    member: Pick<ProjectMemberDto, 'userId' | 'version'>,
  ): Promise<void> {
    const url = tenantUrl(
      organizationId,
      `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(member.userId)}`,
    );
    const params = new HttpParams().set('version', member.version);
    return firstValueFrom(this.http.delete<void>(url, { params }));
  }
}
