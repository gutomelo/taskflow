import {
  Comment,
  type CommentPosition,
  type CommentRepository,
} from '@taskflow/backend/collaboration/domain';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';
import { VersionConflictError } from '@taskflow/backend/shared/kernel';

const withMentions = { mentions: { select: { userId: true } } } as const;

type CommentRow = Readonly<{
  id: string;
  organizationId: string;
  projectId: string;
  taskId: string;
  authorUserId: string;
  body: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  version: number;
  mentions: ReadonlyArray<{ userId: string }>;
}>;

function toComment({ mentions, ...row }: CommentRow): Comment {
  return Comment.restore({ ...row, mentionedUserIds: mentions.map((mention) => mention.userId) });
}

/** Depois de `position` na ordem `(created_at DESC, id DESC)`. */
const after = (position: CommentPosition) => ({
  OR: [
    { createdAt: { lt: position.createdAt } },
    { createdAt: position.createdAt, id: { lt: position.id } },
  ],
});

/**
 * Toda operação aplica `organizationId` em leitura **e** escrita (as menções também). Escritas de
 * um comentário tocam a sua linha e as suas menções.
 */
export class PrismaCommentRepository implements CommentRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async add(comment: Comment): Promise<void> {
    const { mentionedUserIds, ...row } = comment.snapshot();
    const client = this.transactions.client();
    await client.comment.create({ data: row });
    if (mentionedUserIds.length > 0) {
      await client.commentMention.createMany({
        data: mentionedUserIds.map((userId) => ({
          organizationId: row.organizationId,
          commentId: row.id,
          userId,
        })),
      });
    }
  }

  async findById(organizationId: string, commentId: string): Promise<Comment | null> {
    const row = await this.transactions.client().comment.findUnique({
      where: { organizationId_id: { organizationId, id: commentId } },
      include: withMentions,
    });
    return row ? toComment(row) : null;
  }

  async lockById(organizationId: string, commentId: string): Promise<Comment | null> {
    const transaction = this.transactions.transactionalClient('CommentRepository.lockById');
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM comments
      WHERE organization_id = ${organizationId}::uuid AND id = ${commentId}::uuid
      FOR NO KEY UPDATE`;
    if (locked.length === 0) return null;
    const row = await transaction.comment.findUnique({
      where: { organizationId_id: { organizationId, id: commentId } },
      include: withMentions,
    });
    return row ? toComment(row) : null;
  }

  async save(comment: Comment): Promise<void> {
    const {
      organizationId,
      id,
      version,
      body,
      editedAt,
      deletedAt,
      deletedByUserId,
      mentionedUserIds,
    } = comment.snapshot();
    const client = this.transactions.client();
    const { count } = await client.comment.updateMany({
      where: { organizationId, id, version },
      data: { body, editedAt, deletedAt, deletedByUserId, version: { increment: 1 } },
    });
    if (count === 0) throw new VersionConflictError('Comment');
    await client.commentMention.deleteMany({
      where: { organizationId, commentId: id, userId: { notIn: [...mentionedUserIds] } },
    });
    if (mentionedUserIds.length > 0) {
      await client.commentMention.createMany({
        data: mentionedUserIds.map((userId) => ({ organizationId, commentId: id, userId })),
        skipDuplicates: true,
      });
    }
  }

  async page(
    organizationId: string,
    taskId: string,
    limit: number,
    position: CommentPosition | null,
  ): Promise<ReadonlyArray<Comment>> {
    const rows = await this.transactions.client().comment.findMany({
      where: { organizationId, taskId, ...(position ? after(position) : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: withMentions,
    });
    return rows.map(toComment);
  }

  countActive(organizationId: string, taskId: string): Promise<number> {
    return this.transactions.client().comment.count({
      where: { organizationId, taskId, deletedAt: null },
    });
  }
}
