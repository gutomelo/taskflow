import type { OrganizationName } from './organization-name';
import type { OrganizationSlug } from './organization-slug';

export type OrganizationSnapshot = Readonly<{
  id: string;
  name: OrganizationName;
  slug: OrganizationSlug;
  /** BR-024: members criam projetos (padrão `true`); owner/admin sempre podem. */
  membersCanCreateProjects: boolean;
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
    return new Organization({
      id,
      name,
      slug,
      membersCanCreateProjects: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
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

  get settings(): Readonly<{ membersCanCreateProjects: boolean }> {
    return { membersCanCreateProjects: this.state.membersCanCreateProjects };
  }

  /** Configurações (BR-024). Devolve se algo mudou (o evento de segurança só sai nesse caso). */
  updateSettings(settings: Readonly<{ membersCanCreateProjects: boolean }>, now: Date): boolean {
    if (settings.membersCanCreateProjects === this.state.membersCanCreateProjects) return false;
    this.state = {
      ...this.state,
      membersCanCreateProjects: settings.membersCanCreateProjects,
      updatedAt: now,
    };
    return true;
  }

  toSnapshot(): OrganizationSnapshot {
    return this.state;
  }
}
