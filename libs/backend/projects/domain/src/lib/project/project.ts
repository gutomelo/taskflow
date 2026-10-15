import { ProjectArchivedError } from '../errors';
import type { ProjectKey } from './project-key';
import type { ProjectName } from './project-name';

export type ProjectSnapshot = Readonly<{
  id: string;
  organizationId: string;
  /** BR-025: imutável. */
  key: ProjectKey;
  name: ProjectName;
  description: string | null;
  /** BR-026: arquivado ⇔ preenchido. */
  archivedAt: Date | null;
  /** Usuário do contexto `identity` (sem FK entre contextos). */
  createdByUserId: string;
  /** Optimistic locking (BR-008), incrementado pelo repositório ao gravar. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

/** Projeto de uma organização. A chave nunca muda; arquivado é somente leitura (BR-026). */
export class Project {
  private constructor(private state: ProjectSnapshot) {}

  static create(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly key: ProjectKey;
    readonly name: ProjectName;
    readonly description: string | null;
    readonly createdByUserId: string;
    readonly now: Date;
  }): Project {
    const { now, ...rest } = input;
    return new Project({ ...rest, archivedAt: null, version: 1, createdAt: now, updatedAt: now });
  }

  static restore(snapshot: ProjectSnapshot): Project {
    return new Project(snapshot);
  }

  get id(): string {
    return this.state.id;
  }

  get organizationId(): string {
    return this.state.organizationId;
  }

  get version(): number {
    return this.state.version;
  }

  get isArchived(): boolean {
    return this.state.archivedAt !== null;
  }

  /** BR-026: edição só em projeto ativo. */
  update(changes: Readonly<{ name?: ProjectName; description?: string | null }>, now: Date): void {
    if (this.isArchived) throw new ProjectArchivedError();
    this.state = {
      ...this.state,
      ...(changes.name === undefined ? {} : { name: changes.name }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
      updatedAt: now,
    };
  }

  /** Devolve se mudou: arquivar um projeto já arquivado não altera nada (idempotente). */
  archive(now: Date): boolean {
    if (this.isArchived) return false;
    this.state = { ...this.state, archivedAt: now, updatedAt: now };
    return true;
  }

  /** Devolve se mudou: restaurar um projeto ativo não altera nada (idempotente). */
  restore(now: Date): boolean {
    if (!this.isArchived) return false;
    this.state = { ...this.state, archivedAt: null, updatedAt: now };
    return true;
  }

  toSnapshot(): ProjectSnapshot {
    return this.state;
  }
}
