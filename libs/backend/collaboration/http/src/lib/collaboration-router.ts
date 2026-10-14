import { Router, type Request } from 'express';
import {
  HttpError,
  noStore,
  parseBody,
  tenantRequestContextFrom,
} from '@taskflow/backend/shared/http';
import type {
  CommentView,
  CreateCommentUseCase,
  DeleteCommentUseCase,
  EditCommentUseCase,
  GetCommentUseCase,
  ListCommentsUseCase,
  ListMentionCandidatesUseCase,
  PersonView,
} from '@taskflow/backend/collaboration/application';
import {
  commentIdParamSchema,
  commentListQuerySchema,
  createCommentRequestSchema,
  deleteCommentQuerySchema,
  editCommentRequestSchema,
  mentionCandidatesQuerySchema,
  taskIdParamSchema,
  type CommentDto,
  type CommentPage,
  type CommentPerson,
  type MentionCandidatePage,
} from '@taskflow/contracts';
import type { z } from 'zod';

type Executes<T extends { execute: (...args: never[]) => unknown }> = Pick<T, 'execute'>;

export interface CollaborationHttpDependencies {
  readonly useCases: Readonly<{
    listComments: Executes<ListCommentsUseCase>;
    getComment: Executes<GetCommentUseCase>;
    listMentionCandidates: Executes<ListMentionCandidatesUseCase>;
    createComment: Executes<CreateCommentUseCase>;
    editComment: Executes<EditCommentUseCase>;
    deleteComment: Executes<DeleteCommentUseCase>;
  }>;
}

/** Parâmetro de rota malformado responde como recurso inexistente (sem oráculo, sem 500). */
function parseParams<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  notFound: () => HttpError,
): z.output<TSchema> {
  const result = schema.safeParse(request.params);
  if (!result.success) throw notFound();
  return result.data;
}

function parseQuery<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): z.output<TSchema> {
  const result = schema.safeParse(request.query);
  if (result.success) return result.data;
  throw new HttpError(400, 'VALIDATION_FAILED', 'Dados inválidos', {
    violations: result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(query)',
      message: issue.message,
    })),
  });
}

const taskNotFound = () => new HttpError(404, 'TASK_NOT_FOUND', 'Tarefa não encontrada');
const commentNotFound = () => new HttpError(404, 'COMMENT_NOT_FOUND', 'Comentário não encontrado');

const iso = (date: Date | null) => date?.toISOString() ?? null;
const toPerson = (person: PersonView): CommentPerson => ({
  userId: person.userId,
  name: person.name,
});

const toCommentDto = (view: CommentView): CommentDto => ({
  id: view.id,
  taskId: view.taskId,
  author: toPerson(view.author),
  body: view.body,
  mentions: view.mentions.map(toPerson),
  createdAt: view.createdAt.toISOString(),
  editedAt: iso(view.editedAt),
  deletedAt: iso(view.deletedAt),
  version: view.version,
  actions: { ...view.actions },
});

/** Rotas de comentários (spec 010), montadas no escopo do tenant (ADR 0012). */
export function createCollaborationRouter({ useCases }: CollaborationHttpDependencies): Router {
  const router = Router({ mergeParams: true });
  router.use(noStore);

  router.get('/tasks/:taskId/comments', async (request, response) => {
    const { taskId } = parseParams(request, taskIdParamSchema, taskNotFound);
    const page = await useCases.listComments.execute(tenantRequestContextFrom(request), {
      taskId,
      ...parseQuery(request, commentListQuerySchema),
    });
    response.json({
      items: page.items.map(toCommentDto),
      nextCursor: page.nextCursor,
      ...(page.count === undefined ? {} : { count: page.count }),
      actions: { ...page.actions },
    } satisfies CommentPage);
  });

  router.post('/tasks/:taskId/comments', async (request, response) => {
    const { taskId } = parseParams(request, taskIdParamSchema, taskNotFound);
    const { body } = parseBody(request, createCommentRequestSchema);
    const view = await useCases.createComment.execute(tenantRequestContextFrom(request), {
      taskId,
      body,
    });
    response
      .status(201)
      .location(`${request.baseUrl}/comments/${view.id}`)
      .json(toCommentDto(view) satisfies CommentDto);
  });

  router.get('/tasks/:taskId/mentionable-users', async (request, response) => {
    const { taskId } = parseParams(request, taskIdParamSchema, taskNotFound);
    const page = await useCases.listMentionCandidates.execute(tenantRequestContextFrom(request), {
      taskId,
      ...parseQuery(request, mentionCandidatesQuerySchema),
    });
    response.json({
      items: page.items.map(({ userId, name, email }) => ({ userId, name, email })),
      nextCursor: page.nextCursor,
    } satisfies MentionCandidatePage);
  });

  router.get('/comments/:commentId', async (request, response) => {
    const { commentId } = parseParams(request, commentIdParamSchema, commentNotFound);
    const view = await useCases.getComment.execute(tenantRequestContextFrom(request), commentId);
    response.json(toCommentDto(view) satisfies CommentDto);
  });

  router.patch('/comments/:commentId', async (request, response) => {
    const { commentId } = parseParams(request, commentIdParamSchema, commentNotFound);
    const { body, version } = parseBody(request, editCommentRequestSchema);
    const view = await useCases.editComment.execute(tenantRequestContextFrom(request), {
      commentId,
      body,
      version,
    });
    response.json(toCommentDto(view) satisfies CommentDto);
  });

  router.delete('/comments/:commentId', async (request, response) => {
    const { commentId } = parseParams(request, commentIdParamSchema, commentNotFound);
    const { version } = parseQuery(request, deleteCommentQuerySchema);
    await useCases.deleteComment.execute(tenantRequestContextFrom(request), {
      commentId,
      version,
    });
    response.status(204).end();
  });

  return router;
}
