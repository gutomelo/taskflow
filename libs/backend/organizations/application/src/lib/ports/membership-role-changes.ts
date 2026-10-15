import type { OrganizationRole } from '@taskflow/backend/shared/kernel';

/**
 * Notifica, **na mesma transação**, que o papel de um membro mudou (spec 003). Escrita na
 * linguagem de `organizations`: quem reage (hoje `projects`, BR-027) decide o que fazer; esta
 * biblioteca não conhece a regra. Ligada no composition root.
 *
 * Contrato: só chamada dentro de `TransactionRunner.run`, com a organização travada por
 * `lockForMembershipChange`; a implementação usa a mesma instância do runner.
 */
export interface MembershipRoleChanges {
  roleChanged(
    change: Readonly<{
      organizationId: string;
      userId: string;
      fromRole: OrganizationRole;
      toRole: OrganizationRole;
    }>,
  ): Promise<Readonly<{ affectedProjectParticipations: number }>>;
}
