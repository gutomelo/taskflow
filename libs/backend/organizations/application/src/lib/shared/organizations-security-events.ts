import type { OrganizationRole, SecurityEventRecorder } from '@taskflow/backend/shared/application';

type Base = Readonly<{ requestId: string; organizationId: string; actorUserId: string }>;

/** RF-13: eventos de segurança de `organizations` — só ids, nunca e-mail em claro. */
export type OrganizationsSecurityEvent =
  | (Base & Readonly<{ type: 'organizations.created' }>)
  | (Base &
      Readonly<{
        type: 'organizations.member_role_changed';
        targetUserId: string;
        fromRole: OrganizationRole;
        toRole: OrganizationRole;
        revokedInvitations: number;
      }>)
  | (Base &
      Readonly<{
        type: 'organizations.member_removed' | 'organizations.member_left';
        targetUserId: string;
        role: OrganizationRole;
        revokedInvitations: number;
      }>)
  | (Base &
      Readonly<{
        type:
          | 'organizations.invitation_created'
          | 'organizations.invitation_resent'
          | 'organizations.invitation_revoked'
          | 'organizations.invitation_accepted';
        invitationId: string;
        role: OrganizationRole;
      }>);

export type OrganizationsSecurityEventRecorder = SecurityEventRecorder<OrganizationsSecurityEvent>;
