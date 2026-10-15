import { RequiredWithoutParentError, TaskCanceledError } from '../errors';
import type { WorkflowStatusView } from '../workflow/workflow';
import type { Priority, TaskTitle } from './task-fields';

export type TaskSnapshot = Readonly<{
  id: string;
  organizationId: string;
  projectId: string;
  /** BR-028: sequencial por projeto, nunca reutilizado. */
  number: number;
  title: TaskTitle;
  description: string | null;
  statusId: string;
  priority: Priority;
  /** Membro da organização com papel efetivo manager/member no projeto (BR-003). */
  assigneeUserId: string | null;
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
  parentTaskId: string | null;
  isRequired: boolean;
  /** Preenchido ⇔ status de categoria `done`. */
  completedAt: Date | null;
  completedByUserId: string | null;
  canceledAt: Date | null;
  canceledByUserId: string | null;
  createdByUserId: string;
  /** Optimistic locking (BR-008), incrementado pelo repositório ao gravar. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

/** Tarefa ou subtarefa (um nível) de um projeto. */
export class Task {
  private constructor(private state: TaskSnapshot) {}

  static create(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly number: number;
    readonly title: TaskTitle;
    readonly description: string | null;
    readonly status: WorkflowStatusView;
    readonly priority: Priority;
    readonly assigneeUserId: string | null;
    readonly dueDate: string | null;
    readonly parentTaskId: string | null;
    readonly isRequired: boolean;
    readonly createdByUserId: string;
    readonly now: Date;
  }): Task {
    const { status, now, ...rest } = input;
    if (rest.isRequired && rest.parentTaskId === null) throw new RequiredWithoutParentError();
    const done = status.category === 'done';
    return new Task({
      ...rest,
      statusId: status.id,
      completedAt: done ? now : null,
      completedByUserId: done ? rest.createdByUserId : null,
      canceledAt: null,
      canceledByUserId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(snapshot: TaskSnapshot): Task {
    return new Task(snapshot);
  }

  get id(): string {
    return this.state.id;
  }
  get projectId(): string {
    return this.state.projectId;
  }
  get parentTaskId(): string | null {
    return this.state.parentTaskId;
  }
  get statusId(): string {
    return this.state.statusId;
  }
  get version(): number {
    return this.state.version;
  }
  get isRequired(): boolean {
    return this.state.isRequired;
  }
  get isCanceled(): boolean {
    return this.state.canceledAt !== null;
  }
  get isCompleted(): boolean {
    return this.state.completedAt !== null;
  }
  get createdByUserId(): string {
    return this.state.createdByUserId;
  }
  get assigneeUserId(): string | null {
    return this.state.assigneeUserId;
  }
  /** BR-001/BR-006: não concluída e não cancelada. */
  get isPending(): boolean {
    return !this.isCompleted && !this.isCanceled;
  }

  private assertActive(): void {
    if (this.isCanceled) throw new TaskCanceledError();
  }

  edit(
    changes: Readonly<{
      title?: TaskTitle;
      description?: string | null;
      priority?: Priority;
      dueDate?: string | null;
    }>,
    now: Date,
  ): void {
    this.assertActive();
    const defined = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    this.state = { ...this.state, ...defined, updatedAt: now };
  }

  setRequired(isRequired: boolean, now: Date): void {
    this.assertActive();
    if (isRequired && this.state.parentTaskId === null) throw new RequiredWithoutParentError();
    this.state = { ...this.state, isRequired, updatedAt: now };
  }

  assign(assigneeUserId: string | null, now: Date): void {
    this.assertActive();
    this.state = { ...this.state, assigneeUserId, updatedAt: now };
  }

  /** Muda o status (a transição já foi validada contra o workflow); conclusão segue a categoria. */
  moveTo(status: WorkflowStatusView, actorUserId: string, now: Date): void {
    this.assertActive();
    const done = status.category === 'done';
    this.state = {
      ...this.state,
      statusId: status.id,
      completedAt: done ? (this.state.completedAt ?? now) : null,
      completedByUserId: done ? (this.state.completedByUserId ?? actorUserId) : null,
      updatedAt: now,
    };
  }

  /** BR-029. Devolve se mudou (cancelar uma cancelada não altera nada). */
  cancel(actorUserId: string, now: Date): boolean {
    if (this.isCanceled) return false;
    this.state = { ...this.state, canceledAt: now, canceledByUserId: actorUserId, updatedAt: now };
    return true;
  }

  /** BR-029. Devolve se mudou. */
  reopen(now: Date): boolean {
    if (!this.isCanceled) return false;
    this.state = { ...this.state, canceledAt: null, canceledByUserId: null, updatedAt: now };
    return true;
  }

  toSnapshot(): TaskSnapshot {
    return this.state;
  }
}
