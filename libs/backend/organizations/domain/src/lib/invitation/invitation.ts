import type { EmailAddress, OrganizationRole } from '@taskflow/backend/shared/kernel';
import { InvalidInvitationRoleError } from '../errors';

/** BR-020: convites valem 7 dias; reenviar ou reconvidar renova o prazo. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Papéis concedíveis por convite (BR-021: nunca `owner`). */
export type InvitableRole = Exclude<OrganizationRole, 'owner'>;

export type InvitationSnapshot = Readonly<{
  id: string;
  organizationId: string;
  email: EmailAddress;
  role: InvitableRole;
  invitedByUserId: string;
  /** Último evento de envio: só ele pode emitir o token vigente (eventos antigos descartados). */
  deliveryEventId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export function assertInvitableRole(role: OrganizationRole): InvitableRole {
  if (role === 'owner') throw new InvalidInvitationRoleError();
  return role;
}

/**
 * Convite nominal (BR-020): um e-mail, um papel, uma organização; um aberto por e-mail. O token
 * nasce no worker e é guardado só como hash (fora do domínio). O aceite é atômico no banco.
 */
export class Invitation {
  private constructor(private state: InvitationSnapshot) {}

  static create(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly email: EmailAddress;
    readonly role: OrganizationRole;
    readonly invitedByUserId: string;
    readonly deliveryEventId: string;
    readonly now: Date;
  }): Invitation {
    return new Invitation({
      id: input.id,
      organizationId: input.organizationId,
      email: input.email,
      role: assertInvitableRole(input.role),
      invitedByUserId: input.invitedByUserId,
      deliveryEventId: input.deliveryEventId,
      expiresAt: new Date(input.now.getTime() + INVITATION_TTL_MS),
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static restore(snapshot: InvitationSnapshot): Invitation {
    return new Invitation(snapshot);
  }

  get id(): string {
    return this.state.id;
  }

  get invitedByUserId(): string {
    return this.state.invitedByUserId;
  }

  /** Aberto = nem aceito nem revogado (pode estar expirado: reenviar renova). */
  get isOpen(): boolean {
    return this.state.acceptedAt === null && this.state.revokedAt === null;
  }

  isExpired(now: Date): boolean {
    return now.getTime() >= this.state.expiresAt.getTime();
  }

  /** Reenvio (e reconvite com outro papel): novo evento de envio, prazo renovado. */
  redeliver(input: {
    readonly deliveryEventId: string;
    readonly role?: OrganizationRole;
    readonly invitedByUserId: string;
    readonly now: Date;
  }): void {
    this.state = {
      ...this.state,
      role: input.role === undefined ? this.state.role : assertInvitableRole(input.role),
      invitedByUserId: input.invitedByUserId,
      deliveryEventId: input.deliveryEventId,
      expiresAt: new Date(input.now.getTime() + INVITATION_TTL_MS),
      updatedAt: input.now,
    };
  }

  /** Idempotente: preserva o primeiro instante de revogação. */
  revoke(now: Date): void {
    if (this.state.revokedAt !== null || this.state.acceptedAt !== null) return;
    this.state = { ...this.state, revokedAt: now, updatedAt: now };
  }

  toSnapshot(): InvitationSnapshot {
    return this.state;
  }
}
