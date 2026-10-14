import { CommentDeletedError } from '../errors';
import type { CommentContent } from './comment-content';

export type CommentSnapshot = Readonly<{
  id: string;
  organizationId: string;
  projectId: string;
  taskId: string;
  /** Fixo; `comment:update`/`comment:delete` "próprio" é decidido por ele. */
  authorUserId: string;
  /** `null` ⇔ removido (D4): texto e menções apagados de fato. */
  body: string | null;
  mentionedUserIds: ReadonlyArray<string>;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  /** Optimistic locking (BR-008), incrementado pelo repositório ao gravar. */
  version: number;
}>;

/** Resultado de uma edição: só as menções novas são conferidas e publicadas (BR-032, D10). */
export type CommentEdit = Readonly<{
  changed: boolean;
  addedMentionUserIds: ReadonlyArray<string>;
}>;

/** Comentário de uma tarefa (BR-031). */
export class Comment {
  private constructor(private state: CommentSnapshot) {}

  static create(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly taskId: string;
    readonly authorUserId: string;
    readonly content: CommentContent;
    readonly now: Date;
  }): Comment {
    const { content, now, ...rest } = input;
    return new Comment({
      ...rest,
      body: content.body,
      mentionedUserIds: content.mentionedUserIds,
      createdAt: now,
      editedAt: null,
      deletedAt: null,
      deletedByUserId: null,
      version: 1,
    });
  }

  static restore(snapshot: CommentSnapshot): Comment {
    return new Comment(snapshot);
  }

  get id(): string {
    return this.state.id;
  }
  get taskId(): string {
    return this.state.taskId;
  }
  get authorUserId(): string {
    return this.state.authorUserId;
  }
  get version(): number {
    return this.state.version;
  }
  get isDeleted(): boolean {
    return this.state.deletedAt !== null;
  }
  get mentionedUserIds(): ReadonlyArray<string> {
    return this.state.mentionedUserIds;
  }

  /**
   * Menções que o conteúdo acrescentaria às atuais (as que exigem conferência de acesso). As
   * mantidas continuam válidas mesmo que a pessoa tenha perdido o acesso (D10).
   */
  newMentionsIn(content: CommentContent): ReadonlyArray<string> {
    const current = new Set(this.state.mentionedUserIds);
    return content.mentionedUserIds.filter((userId) => !current.has(userId));
  }

  /** Removido ⇒ `COMMENT_DELETED`. Texto igual: nada muda (sem versão nova nem evento). */
  edit(content: CommentContent, now: Date): CommentEdit {
    if (this.isDeleted) throw new CommentDeletedError();
    if (content.body === this.state.body) return { changed: false, addedMentionUserIds: [] };
    const addedMentionUserIds = this.newMentionsIn(content);
    this.state = {
      ...this.state,
      body: content.body,
      mentionedUserIds: content.mentionedUserIds,
      editedAt: now,
    };
    return { changed: true, addedMentionUserIds };
  }

  /** Exclusão lógica, irreversível e idempotente: `false` se já estava removido. */
  delete(actorUserId: string, now: Date): boolean {
    if (this.isDeleted) return false;
    this.state = {
      ...this.state,
      body: null,
      mentionedUserIds: [],
      deletedAt: now,
      deletedByUserId: actorUserId,
    };
    return true;
  }

  snapshot(): CommentSnapshot {
    return this.state;
  }
}
