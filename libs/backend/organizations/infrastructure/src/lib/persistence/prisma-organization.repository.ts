import { VersionConflictError } from '@taskflow/backend/shared/kernel';
import {
  SlugTakenError,
  type Organization,
  type OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import {
  isUniqueConstraintViolation,
  type PrismaTransactionRunner,
} from '@taskflow/backend/shared/infrastructure';
import { toOrganization } from './organizations-mappers';

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async add(organization: Organization): Promise<void> {
    const { id, name, slug, membersCanCreateProjects, version, createdAt, updatedAt } =
      organization.toSnapshot();
    try {
      await this.transactions.client().organization.create({
        data: {
          id,
          name: name.value,
          slug: slug.value,
          membersCanCreateProjects,
          version,
          createdAt,
          updatedAt,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw new SlugTakenError();
      throw error;
    }
  }

  async findById(organizationId: string): Promise<Organization | null> {
    const row = await this.transactions.client().organization.findUnique({
      where: { id: organizationId },
    });
    return row ? toOrganization(row) : null;
  }

  async findByIds(organizationIds: ReadonlyArray<string>): Promise<ReadonlyArray<Organization>> {
    if (organizationIds.length === 0) {
      return [];
    }
    const rows = await this.transactions.client().organization.findMany({
      where: { id: { in: [...organizationIds] } },
    });
    return rows.map(toOrganization);
  }

  async save(organization: Organization): Promise<void> {
    const { id, name, membersCanCreateProjects, version, updatedAt } = organization.toSnapshot();
    const { count } = await this.transactions.client().organization.updateMany({
      where: { id, version },
      data: { name: name.value, membersCanCreateProjects, updatedAt, version: { increment: 1 } },
    });
    if (count === 0) throw new VersionConflictError('Organization');
  }

  async lockForMembershipChange(organizationId: string): Promise<boolean> {
    const transaction = this.transactions.transactionalClient(
      'OrganizationRepository.lockForMembershipChange',
    );
    // FOR NO KEY UPDATE: serializa mutações de membership entre si sem bloquear o FOR KEY SHARE
    // das FKs (aceites e convites não esperam). Não altera `version` (edição do nome segue livre).
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR NO KEY UPDATE`;
    return locked.length > 0;
  }

  async lockForShare(organizationId: string): Promise<Organization | null> {
    const transaction = this.transactions.transactionalClient(
      'OrganizationRepository.lockForShare',
    );
    // FOR SHARE conflita com o FOR NO KEY UPDATE das mutações de membership (spec 003): papéis e
    // configuração lidos aqui não mudam até o commit. Mutações de projetos correm em paralelo.
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
    if (locked.length === 0) return null;
    const row = await transaction.organization.findUnique({ where: { id: organizationId } });
    return row ? toOrganization(row) : null;
  }
}
