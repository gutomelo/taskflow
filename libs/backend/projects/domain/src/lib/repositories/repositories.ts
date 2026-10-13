import type { ProjectRole } from '@taskflow/backend/shared/kernel';
import type { ProjectMember } from '../participation/project-member';
import type { Project } from '../project/project';
import type { Workflow } from '../workflow/workflow';

/** Página por cursor (opaco). */
export type Page<T> = Readonly<{ items: ReadonlyArray<T>; nextCursor: string | null }>;
export type PageRequest = Readonly<{ limit: number; cursor: string | null }>;

/**
 * Quem está lendo (BR-023): owner/admin veem todos os projetos (`seesAll`); os demais só aqueles
 * de que participam.
 */
export type ProjectViewer = Readonly<{ userId: string; seesAll: boolean }>;

/** Projeto visível com a participação do leitor (para o papel efetivo). */
export type VisibleProject = Readonly<{ project: Project; participation: ProjectRole | null }>;

/** Todas as operações recebem `organizationId` e o aplicam em leitura **e** escrita. */
export interface ProjectRepository {
  /** Lança `ProjectKeyTakenError` se a chave já existir na organização (inclusive por corrida). */
  add(project: Project, workflow: Workflow): Promise<void>;
  /** Projeto visível ao leitor, numa única consulta (sem oráculo de tempo entre "não existe" e "sem acesso"). */
  findVisible(
    organizationId: string,
    by: Readonly<{ projectId: string } | { key: string }>,
    viewer: ProjectViewer,
  ): Promise<VisibleProject | null>;
  listVisiblePage(
    organizationId: string,
    filter: Readonly<{ viewer: ProjectViewer; archived: boolean }>,
    page: PageRequest,
  ): Promise<Page<VisibleProject>>;
  countInOrganization(organizationId: string): Promise<number>;
  /**
   * Trava o projeto até o fim da transação (`FOR NO KEY UPDATE`) e o devolve; `null` se não
   * existir na organização. Só dentro de transação.
   */
  lockForUpdate(organizationId: string, projectId: string): Promise<Project | null>;
  /** BR-008: `VersionConflictError` se a versão lida estiver desatualizada. */
  save(project: Project): Promise<void>;
  findWorkflow(organizationId: string, projectId: string): Promise<Workflow>;
}

export interface ProjectMemberRepository {
  /**
   * Lança `AlreadyAProjectMemberError` se já participa (índice único). A FK para `memberships`
   * recusa quem não é membro da organização: lança `NotAnOrganizationMemberError`.
   */
  add(member: ProjectMember): Promise<void>;
  find(organizationId: string, projectId: string, userId: string): Promise<ProjectMember | null>;
  listPage(
    organizationId: string,
    projectId: string,
    page: PageRequest,
  ): Promise<Page<ProjectMember>>;
  /** Todos os participantes (limitados a `MAX_MEMBERS_PER_PROJECT`), para excluir dos candidatos. */
  listUserIds(organizationId: string, projectId: string): Promise<ReadonlyArray<string>>;
  count(organizationId: string, projectId: string): Promise<number>;
  /** BR-008: `VersionConflictError` se desatualizada. */
  save(member: ProjectMember): Promise<void>;
  /** BR-008: `VersionConflictError` se a versão não bater. */
  remove(organizationId: string, projectId: string, userId: string, version: number): Promise<void>;
  /**
   * BR-027: rebaixa a `viewer` todas as participações do usuário na organização, incrementando a
   * versão; devolve quantas mudaram. Só dentro de transação.
   */
  capToViewer(organizationId: string, userId: string, now: Date): Promise<number>;
}
