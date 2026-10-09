import type { Invitation, InvitableRole } from '@taskflow/backend/organizations/domain';
import type { UserAccount } from '../ports/user-directory';

/**
 * Convite visto por owner/admin. Igual para e-mail com ou sem conta: nada de `hasAccount`, nome
 * ou status da conta convidada (enumeração).
 */
export type InvitationView = Readonly<{
  id: string;
  email: string;
  role: InvitableRole;
  status: 'pending' | 'expired';
  invitedBy: Readonly<{ userId: string; name: string | null }>;
  expiresAt: Date;
  createdAt: Date;
}>;

export function toInvitationView(
  invitation: Invitation,
  inviter: UserAccount | undefined,
  now: Date,
): InvitationView {
  const { id, email, role, invitedByUserId, expiresAt, createdAt } = invitation.toSnapshot();
  return {
    id,
    email: email.value,
    role,
    status: invitation.isExpired(now) ? 'expired' : 'pending',
    invitedBy: { userId: invitedByUserId, name: inviter?.name ?? null },
    expiresAt,
    createdAt,
  };
}
