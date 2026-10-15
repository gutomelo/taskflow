import type { OrganizationRole } from '@taskflow/backend/shared/kernel';

/** Vínculo atual de uma pessoa com uma organização (para o resumo). */
export type OrganizationMembership = Readonly<{ slug: string; role: OrganizationRole }>;

/** Endereço para o resumo: só e-mail verificado (defesa em profundidade, I3 da segurança). */
export type DigestAddress = Readonly<{ email: string; name: string }>;

/** Pessoas, papéis e organizações (adaptador: `organizations` + `identity`). */
export interface NotificationPeople {
  /** Nomes só de quem ainda é membro da organização; ausente = "Ex-membro". */
  displayNames(
    organizationId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, string>>;
  /** Organizações dadas em que a pessoa ainda é membro, com o slug e o papel atual. */
  memberships(
    userId: string,
    organizationIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, OrganizationMembership>>;
  /** `null` = sem conta ou e-mail não verificado. */
  digestAddress(userId: string): Promise<DigestAddress | null>;
}
