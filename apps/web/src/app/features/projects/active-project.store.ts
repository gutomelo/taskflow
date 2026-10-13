import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { ProjectDto, ProjectPermission } from '@taskflow/contracts';
import { isProblemDetails } from '../../core/http/contract-guards';
import { ActiveOrganizationStore } from '../../core/organizations';
import { ProjectApi } from './project-api';

/** Estado de navegação: a lista mostra o aviso de projeto inexistente ou sem acesso. */
export const PROJECT_NOT_FOUND_STATE = { projectNotFound: true } as const;

type Status = 'loading' | 'loaded' | 'error';

/** 404 de projeto (removido do projeto, rebaixado, chave inexistente): sem distinção. */
export function isProjectNotFound(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 404 &&
    isProblemDetails(error.error) &&
    error.error.code === 'PROJECT_NOT_FOUND'
  );
}

/**
 * Projeto aberto em `/o/:slug/projects/:key` (RF-11). Provido no layout do projeto, que o router
 * recria quando a chave muda: as páginas filhas nunca misturam dois projetos.
 */
@Injectable()
export class ActiveProjectStore {
  private readonly api = inject(ProjectApi);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly router = inject(Router);
  private readonly state = signal<{ status: Status; project: ProjectDto | null; key: string }>({
    status: 'loading',
    project: null,
    key: '',
  });

  readonly status = computed(() => this.state().status);
  readonly project = computed(() => this.state().project);
  /** Sem projeto carregado não há arquivamento (`undefined` não conta como arquivado). */
  readonly isArchived = computed(() => (this.state().project?.archivedAt ?? null) !== null);
  private readonly capabilities = computed(
    () => new Set<string>(this.state().project?.capabilities ?? []),
  );

  /**
   * Capacidade calculada pela API (já descontado o arquivamento): a interface esconde o que seria
   * negado, sem matriz própria. Dica apenas — a API decide toda ação.
   */
  can(permission: ProjectPermission): boolean {
    return this.capabilities().has(permission);
  }

  async load(key: string): Promise<void> {
    this.state.set({ status: 'loading', project: null, key });
    try {
      const project = await this.api.getByKey(this.organization.requireId(), key);
      this.state.set({ status: 'loaded', project, key });
    } catch (error) {
      if (isProjectNotFound(error)) return this.leave();
      this.state.update((state) => ({ ...state, status: 'error' }));
    }
  }

  /**
   * Recarrega do servidor (versão nova, capacidades depois de mudar o próprio papel). Com o projeto
   * já carregado, sem passar por "carregando": as páginas filhas continuam montadas (e suas
   * mensagens visíveis). Sem projeto (erro anterior), recomeça do zero.
   */
  async reload(): Promise<void> {
    const { key, status } = this.state();
    if (status !== 'loaded') return this.load(key);
    try {
      const project = await this.api.getByKey(this.organization.requireId(), key);
      this.state.update((state) => ({ ...state, project }));
    } catch (error) {
      // Falha transitória: mantém o projeto exibido; 404 leva à lista.
      if (isProjectNotFound(error)) await this.leave();
    }
  }

  /** Resposta de uma mutação do projeto (ex.: arquivar) substitui o estado. */
  replace(project: ProjectDto): void {
    this.state.update((state) => ({ ...state, project }));
  }

  requireId(): string {
    const id = this.state().project?.id;
    if (!id) throw new Error('No active project');
    return id;
  }

  /** Qualquer 404 de projeto numa página filha: volta à lista com aviso. */
  handle(error: unknown): boolean {
    if (!isProjectNotFound(error)) return false;
    void this.leave();
    return true;
  }

  private async leave(): Promise<void> {
    await this.router.navigate(['/o', this.organization.organization()?.slug, 'projects'], {
      state: PROJECT_NOT_FOUND_STATE,
    });
  }
}
