import type { OrganizationRole } from '@taskflow/backend/shared/application';
import { memberActions, type Membership } from '@taskflow/backend/organizations/domain';
import type { UserAccount } from '../ports/user-directory';

/**
 * Membro visto pelos demais (RF-09; e-mail visível a todos os membros por decisão do usuário).
 * `name`/`email` nulos só se a conta sumiu de `identity` — não deveria ocorrer: a RF-15 da
 * spec 001 só apaga contas não verificadas, que não podem ser membros (BR-013).
 * `actions` (spec 006): o que o usuário atual pode fazer sobre este membro (dica de interface).
 */
export type MemberView = Readonly<{
  userId: string;
  name: string | null;
  email: string | null;
  role: OrganizationRole;
  version: number;
  joinedAt: Date;
  actions: Readonly<{ changeRoleTo: ReadonlyArray<OrganizationRole>; remove: boolean }>;
}>;

/** Quem está olhando: papel (do middleware em leituras; relido sob lock em mutações) e id. */
export type Viewer = Readonly<{ role: OrganizationRole; userId: string }>;

export function toMemberView(
  membership: Membership,
  account: UserAccount | undefined,
  viewer: Viewer,
  version = membership.version,
): MemberView {
  const { userId, role, createdAt } = membership.toSnapshot();
  return {
    userId,
    name: account?.name ?? null,
    email: account?.email ?? null,
    role,
    version,
    joinedAt: createdAt,
    actions: memberActions({ actor: viewer.role, target: role, isSelf: userId === viewer.userId }),
  };
}
