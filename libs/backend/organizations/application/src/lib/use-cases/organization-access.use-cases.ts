import type { OrganizationRole } from '@taskflow/backend/shared/application';
import type {
  MembershipRepository,
  OrganizationRepository,
  Page,
} from '@taskflow/backend/organizations/domain';
import { toPageRequest, type PageQuery } from '../shared/pagination';

// Casos de uso que servem à porta `OrganizationAccess` de `projects` (spec 003), ligada no
// composition root. Não são expostos por HTTP; o chamador já passou pelo escopo do tenant.

export type OrganizationAccessSnapshot = Readonly<{
  membersCanCreateProjects: boolean;
  /** Papéis relidos dos usuários pedidos que são membros; ausente = não é membro. */
  roles: ReadonlyMap<string, OrganizationRole>;
}>;

/**
 * Trava a organização para compartilhamento (`FOR SHARE`) e relê configuração e papéis: até o
 * commit, nenhuma mudança de membership (que trava `FOR NO KEY UPDATE`) passa. `null` se a
 * organização não existir. Contrato: chamado dentro da transação do chamador.
 */
export class LockOrganizationForShareUseCase {
  constructor(
    private readonly deps: {
      readonly organizations: OrganizationRepository;
      readonly memberships: MembershipRepository;
    },
  ) {}

  /**
   * Sem `TransactionRunner.run` de propósito: fora de uma transação, `lockForShare` lança (o
   * lock seria solto na hora) em vez de abrir uma transação própria e soltar o lock em silêncio.
   */
  async execute(
    organizationId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<OrganizationAccessSnapshot | null> {
    const organization = await this.deps.organizations.lockForShare(organizationId);
    if (!organization) return null;
    return {
      membersCanCreateProjects: organization.settings.membersCanCreateProjects,
      roles: await this.deps.memberships.rolesOf(organizationId, userIds),
    };
  }
}

/** Papéis atuais (sem lock) para leituras de `projects` (listas de participantes). */
export class GetMemberRolesUseCase {
  constructor(private readonly deps: { readonly memberships: MembershipRepository }) {}

  execute(
    organizationId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, OrganizationRole>> {
    return this.deps.memberships.rolesOf(organizationId, userIds);
  }
}

/** Página de membros com os papéis pedidos e fora de uma lista (candidatos a projeto). */
export class ListMembersExcludingUseCase {
  constructor(private readonly deps: { readonly memberships: MembershipRepository }) {}

  async execute(
    organizationId: string,
    filter: Readonly<{
      excludeUserIds: ReadonlyArray<string>;
      roles: ReadonlyArray<OrganizationRole>;
    }>,
    query: PageQuery,
  ): Promise<Page<Readonly<{ userId: string; role: OrganizationRole }>>> {
    const page = await this.deps.memberships.listPageExcluding(
      organizationId,
      filter,
      toPageRequest(query),
    );
    return {
      items: page.items.map((membership) => ({ userId: membership.userId, role: membership.role })),
      nextCursor: page.nextCursor,
    };
  }
}
