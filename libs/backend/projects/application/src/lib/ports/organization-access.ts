import type { OrganizationRole } from '@taskflow/backend/shared/kernel';
import type { Page } from '@taskflow/backend/projects/domain';

export type OrganizationAccessSnapshot = Readonly<{
  membersCanCreateProjects: boolean;
  /** Papéis relidos; usuário ausente = não é (mais) membro da organização. */
  roles: ReadonlyMap<string, OrganizationRole>;
}>;

/**
 * O que `projects` precisa de `organizations` (spec 003), ligado no composition root. Substitui o
 * nome `ProjectCreationSettings` da obrigação 1 da spec 006, ampliado com papéis e listagem.
 */
export interface OrganizationAccess {
  /**
   * Trava a organização para compartilhamento (`FOR SHARE`) até o commit e relê configuração e
   * papéis: mudanças de membership esperam. Contrato: só dentro de `TransactionRunner.run` do
   * chamador (fora dela, lança). `null` se a organização não existir.
   */
  lockForShare(
    organizationId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<OrganizationAccessSnapshot | null>;
  /**
   * Trava as memberships das pessoas indicadas `FOR SHARE` e devolve os papéis (spec 004): sem
   * travar a linha da organização. Contrato: dentro da transação do chamador.
   */
  lockMembersForShare(
    organizationId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, OrganizationRole>>;
  /** Papéis atuais, sem lock (leituras). */
  rolesOf(
    organizationId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, OrganizationRole>>;
  /** Membros com um dos `roles` e fora de `excludeUserIds`, por cursor (candidatos). */
  listMembersPage(
    input: Readonly<{
      organizationId: string;
      excludeUserIds: ReadonlyArray<string>;
      roles: ReadonlyArray<OrganizationRole>;
      limit: number;
      cursor: string | null;
    }>,
  ): Promise<Page<Readonly<{ userId: string; role: OrganizationRole }>>>;
}
