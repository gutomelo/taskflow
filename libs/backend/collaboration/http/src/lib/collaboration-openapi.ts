import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { z } from 'zod';
import { problemResponse, SECURITY } from '@taskflow/backend/shared/http';
import {
  commentListQuerySchema,
  commentPageSchema,
  commentPersonSchema,
  commentSchema,
  createCommentRequestSchema,
  deleteCommentQuerySchema,
  editCommentRequestSchema,
  mentionCandidatePageSchema,
  mentionCandidatesQuerySchema,
} from '@taskflow/contracts';

/** Componentes reutilizáveis do contexto collaboration no documento OpenAPI. */
export const collaborationOpenApiSchemas = {
  CommentPerson: commentPersonSchema,
  Comment: commentSchema,
  CommentPage: commentPageSchema,
  MentionCandidatePage: mentionCandidatePageSchema,
};

const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
const tags = ['Comments'];
const organizationPath = z.object({ organizationId: z.uuid() });
const taskPath = organizationPath.extend({ taskId: z.uuid() });
const commentPath = organizationPath.extend({ commentId: z.uuid() });
const ORGANIZATION = '/api/v1/organizations/{organizationId}';
const unauthenticated = problemResponse('Não autenticado ou sessão encerrada');
const forbidden = problemResponse('Papel insuficiente ou falha de CSRF (INSUFFICIENT_ROLE)');
const writeLimit = problemResponse(
  'Limite excedido: collaboration.comments.write.user.hour (Retry-After)',
);
const taskNotFound = problemResponse(
  'Tarefa inexistente, de outra organização ou de projeto sem acesso — mesma resposta (TASK_NOT_FOUND)',
);
const commentNotFound = problemResponse(
  'Comentário inexistente, de outra organização ou de projeto sem acesso — mesma resposta (COMMENT_NOT_FOUND)',
);
const invalidBody = problemResponse(
  'Dados inválidos (VALIDATION_FAILED) ou texto fora das regras (INVALID_COMMENT_BODY)',
);

export const collaborationOpenApiPaths: ZodOpenApiPathsObject = {
  [`${ORGANIZATION}/tasks/{taskId}/comments`]: {
    get: {
      tags,
      summary: 'Conversa da tarefa, mais recentes primeiro (project:read; RF-01)',
      security: SECURITY.authenticated,
      requestParams: { path: taskPath, query: commentListQuerySchema },
      responses: {
        '200': { description: 'Página da conversa', ...json(commentPageSchema) },
        '400': problemResponse('Consulta ou cursor inválidos (INVALID_CURSOR)'),
        '401': unauthenticated,
        '404': taskNotFound,
      },
    },
    post: {
      tags,
      summary: 'Comenta, com menções <@id> no texto (comment:create; BR-031, BR-032)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: taskPath },
      requestBody: json(createCommentRequestSchema),
      responses: {
        '201': { description: 'Comentário criado (Location)', ...json(commentSchema) },
        '400': invalidBody,
        '401': unauthenticated,
        '403': forbidden,
        '404': taskNotFound,
        '409': problemResponse('PROJECT_ARCHIVED, TASK_CANCELED ou CONCURRENT_UPDATE'),
        '422': problemResponse('INVALID_MENTION, TOO_MANY_MENTIONS ou COMMENT_LIMIT_REACHED'),
        '429': writeLimit,
      },
    },
  },
  [`${ORGANIZATION}/tasks/{taskId}/mentionable-users`]: {
    get: {
      tags,
      summary: 'Quem pode ser mencionado: leitores do projeto por nome ou e-mail (comment:create)',
      security: SECURITY.authenticated,
      requestParams: { path: taskPath, query: mentionCandidatesQuerySchema },
      responses: {
        '200': { description: 'Candidatos', ...json(mentionCandidatePageSchema) },
        '400': problemResponse('Consulta ou cursor inválidos (INVALID_CURSOR)'),
        '401': unauthenticated,
        '403': forbidden,
        '404': taskNotFound,
        '422': problemResponse('TOO_MANY_READERS'),
        '429': problemResponse('Limite excedido: collaboration.mentions.read.user.minute'),
      },
    },
  },
  [`${ORGANIZATION}/comments/{commentId}`]: {
    get: {
      tags,
      summary: 'Um comentário pelo id (project:read; RF-14)',
      security: SECURITY.authenticated,
      requestParams: { path: commentPath },
      responses: {
        '200': { description: 'Comentário', ...json(commentSchema) },
        '401': unauthenticated,
        '404': commentNotFound,
      },
    },
    patch: {
      tags,
      summary: 'Edita o próprio comentário com a versão (comment:update; BR-008)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: commentPath },
      requestBody: json(editCommentRequestSchema),
      responses: {
        '200': { description: 'Comentário editado', ...json(commentSchema) },
        '400': invalidBody,
        '401': unauthenticated,
        '403': forbidden,
        '404': commentNotFound,
        '409': problemResponse(
          'PROJECT_ARCHIVED, TASK_CANCELED, COMMENT_DELETED, VERSION_CONFLICT ou CONCURRENT_UPDATE',
        ),
        '422': problemResponse('INVALID_MENTION ou TOO_MANY_MENTIONS'),
        '429': writeLimit,
      },
    },
    delete: {
      tags,
      summary:
        'Remove o comentário (autor; manager modera), também em só leitura; idempotente (comment:delete)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: commentPath, query: deleteCommentQuerySchema },
      responses: {
        '204': { description: 'Removido (ou já estava)' },
        '400': problemResponse('Versão ausente ou inválida'),
        '401': unauthenticated,
        '403': forbidden,
        '404': commentNotFound,
        '409': problemResponse('VERSION_CONFLICT ou CONCURRENT_UPDATE'),
        '429': writeLimit,
      },
    },
  },
};
