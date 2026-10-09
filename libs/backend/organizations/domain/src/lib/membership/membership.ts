import type { OrganizationRole } from '@taskflow/backend/shared/kernel';

export type MembershipSnapshot = Readonly<{
  id: string;
  organizationId: string;
  /** Usuário do contexto `identity` (sem FK entre contextos). */
  userId: string;
  role: OrganizationRole;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

/** Associação usuário ↔ organização com um papel. Remover = apagar (histórico nos logs). */
export class Membership {
  private constructor(private state: MembershipSnapshot) {}

  static create(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly userId: string;
    readonly role: OrganizationRole;
    readonly now: Date;
  }): Membership {
    const { id, organizationId, userId, role, now } = input;
    return new Membership({
      id,
      organizationId,
      userId,
      role,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(snapshot: MembershipSnapshot): Membership {
    return new Membership(snapshot);
  }

  get userId(): string {
    return this.state.userId;
  }

  get role(): OrganizationRole {
    return this.state.role;
  }

  get version(): number {
    return this.state.version;
  }

  changeRole(role: OrganizationRole, now: Date): void {
    this.state = { ...this.state, role, updatedAt: now };
  }

  toSnapshot(): MembershipSnapshot {
    return this.state;
  }
}
