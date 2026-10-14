import { VersionConflictError } from '@taskflow/backend/shared/kernel';
import {
  ProjectKeyTakenError,
  type Page,
  type PageRequest,
  type Project,
  type ProjectRepository,
  type ProjectViewer,
  type VisibleProject,
  type Workflow,
} from '@taskflow/backend/projects/domain';
import {
  isUniqueConstraintViolation,
  type PrismaTransactionRunner,
} from '@taskflow/backend/shared/infrastructure';
import { decodeCursor, encodeCursor } from './keyset-cursor';
import { projectRoleFrom, toProject, toWorkflow } from './projects-mappers';

/**
 * BR-023: owner/admin veem todos os projetos; os demais só aqueles de que participam. O filtro
 * fica na mesma consulta do projeto — "não existe" e "sem acesso" seguem o mesmo caminho.
 */
function visibleTo(viewer: ProjectViewer) {
  return viewer.seesAll ? {} : { members: { some: { userId: viewer.userId } } };
}

/** Só a participação do próprio leitor (papel efetivo). */
function participationOf(viewer: ProjectViewer) {
  return { members: { where: { userId: viewer.userId }, select: { role: true } } } as const;
}

/** Toda operação aplica `organizationId` em leitura **e** escrita (isolamento entre tenants). */
export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async add(project: Project, workflow: Workflow): Promise<void> {
    const transaction = this.transactions.transactionalClient('ProjectRepository.add');
    const { key, name, ...snapshot } = project.toSnapshot();
    const { id: projectId, organizationId } = snapshot;
    try {
      await transaction.project.create({
        data: { ...snapshot, key: key.value, name: name.value },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw new ProjectKeyTakenError();
      throw error;
    }
    await transaction.workflowStatus.createMany({
      data: workflow.statuses.map((status) => ({ ...status, organizationId, projectId })),
    });
    await transaction.workflowTransition.createMany({
      data: workflow.transitions.map((transition) => ({
        ...transition,
        organizationId,
        projectId,
      })),
    });
  }

  async findVisible(
    organizationId: string,
    by: Readonly<{ projectId: string } | { key: string }>,
    viewer: ProjectViewer,
  ): Promise<VisibleProject | null> {
    const row = await this.transactions.client().project.findFirst({
      where: {
        organizationId,
        ...('projectId' in by ? { id: by.projectId } : { key: by.key }),
        ...visibleTo(viewer),
      },
      include: participationOf(viewer),
    });
    if (!row) return null;
    const { members, ...project } = row;
    const participation = members[0];
    return {
      project: toProject(project),
      participation: participation ? projectRoleFrom(participation.role) : null,
    };
  }

  async listVisiblePage(
    organizationId: string,
    filter: Readonly<{ viewer: ProjectViewer; archived: boolean }>,
    { limit, cursor }: PageRequest,
  ): Promise<Page<VisibleProject>> {
    const position = decodeCursor(cursor);
    const rows = await this.transactions.client().project.findMany({
      where: {
        organizationId,
        archivedAt: filter.archived ? { not: null } : null,
        ...visibleTo(filter.viewer),
        ...(position
          ? {
              OR: [
                { name: { gt: position.value } },
                { name: position.value, id: { gt: position.id } },
              ],
            }
          : {}),
      },
      include: participationOf(filter.viewer),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(({ members, ...project }) => {
        const participation = members[0];
        return {
          project: toProject(project),
          participation: participation ? projectRoleFrom(participation.role) : null,
        };
      }),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ value: last.name, id: last.id }) : null,
    };
  }

  countInOrganization(organizationId: string): Promise<number> {
    return this.transactions.client().project.count({ where: { organizationId } });
  }

  async lockForShare(
    organizationId: string,
    by: Readonly<{ projectId: string } | { key: string }>,
  ): Promise<Project | null> {
    const transaction = this.transactions.transactionalClient('ProjectRepository.lockForShare');
    // FOR SHARE: escritas de tarefa em paralelo, serializadas com arquivamento e mudanças de
    // participação (FOR NO KEY UPDATE). Só o lock em SQL; os dados pela consulta tipada.
    const locked =
      'projectId' in by
        ? await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM projects
            WHERE organization_id = ${organizationId}::uuid AND id = ${by.projectId}::uuid
            FOR SHARE`
        : await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM projects
            WHERE organization_id = ${organizationId}::uuid AND key = ${by.key}
            FOR SHARE`;
    const [first] = locked;
    if (!first) return null;
    const row = await transaction.project.findUnique({
      where: { organizationId_id: { organizationId, id: first.id } },
    });
    return row ? toProject(row) : null;
  }

  async lockForUpdate(organizationId: string, projectId: string): Promise<Project | null> {
    const transaction = this.transactions.transactionalClient('ProjectRepository.lockForUpdate');
    // FOR NO KEY UPDATE: serializa mutações do projeto sem bloquear o FOR KEY SHARE das FKs.
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM projects
      WHERE organization_id = ${organizationId}::uuid AND id = ${projectId}::uuid
      FOR NO KEY UPDATE`;
    if (locked.length === 0) return null;
    const row = await transaction.project.findUnique({
      where: { organizationId_id: { organizationId, id: projectId } },
    });
    return row ? toProject(row) : null;
  }

  async save(project: Project): Promise<void> {
    const { organizationId, id, name, description, archivedAt, version, updatedAt } =
      project.toSnapshot();
    const { count } = await this.transactions.client().project.updateMany({
      where: { organizationId, id, version },
      data: { name: name.value, description, archivedAt, updatedAt, version: { increment: 1 } },
    });
    if (count === 0) throw new VersionConflictError('Project');
  }

  async findWorkflow(organizationId: string, projectId: string): Promise<Workflow> {
    const client = this.transactions.client();
    const [statuses, transitions] = await Promise.all([
      client.workflowStatus.findMany({
        where: { organizationId, projectId },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
      client.workflowTransition.findMany({
        where: { organizationId, projectId },
        orderBy: [{ fromStatusId: 'asc' }, { toStatusId: 'asc' }],
      }),
    ]);
    return toWorkflow(statuses, transitions);
  }
}
