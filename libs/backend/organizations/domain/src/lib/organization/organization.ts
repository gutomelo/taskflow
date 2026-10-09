import type { OrganizationName } from './organization-name';
import type { OrganizationSlug } from './organization-slug';

export type OrganizationSnapshot = Readonly<{
  id: string;
  name: OrganizationName;
  slug: OrganizationSlug;
  /** Optimistic locking (BR-008); o lock de membership não o altera. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

/** Tenant do TaskFlow. O slug nunca muda (BR-022); o nome é editável. */
export class Organization {
  private constructor(private state: OrganizationSnapshot) {}

  static create(input: {
    readonly id: string;
    readonly name: OrganizationName;
    readonly slug: OrganizationSlug;
    readonly now: Date;
  }): Organization {
    const { id, name, slug, now } = input;
    return new Organization({ id, name, slug, version: 1, createdAt: now, updatedAt: now });
  }

  static restore(snapshot: OrganizationSnapshot): Organization {
    return new Organization(snapshot);
  }

  get id(): string {
    return this.state.id;
  }

  get version(): number {
    return this.state.version;
  }

  rename(name: OrganizationName, now: Date): void {
    this.state = { ...this.state, name, updatedAt: now };
  }

  toSnapshot(): OrganizationSnapshot {
    return this.state;
  }
}
