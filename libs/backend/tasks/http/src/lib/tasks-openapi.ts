import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { z } from 'zod';
import { problemResponse, SECURITY } from '@taskflow/backend/shared/http';
import {
  addDependencyRequestSchema,
  boardQuerySchema,
  boardSchema,
  cardSchema,
  columnPageSchema,
  columnQuerySchema,
  moveCardRequestSchema,
  moveCardResponseSchema,
  assignableUserPageSchema,
  assignableUserSchema,
  assignableUsersQuerySchema,
  assignTaskRequestSchema,
  createTaskRequestSchema,
  deleteTaskQuerySchema,
  taskActionsSchema,
  taskListQuerySchema,
  taskPageSchema,
  taskPrioritySchema,
  taskSchema,
  taskSummarySchema,
  taskVersionRequestSchema,
  transitionTaskRequestSchema,
  updateTaskRequestSchema,
} from '@taskflow/contracts';

/** Componentes reutilizáveis do contexto tasks no documento OpenAPI. */
export const tasksOpenApiSchemas = {
  TaskPriority: taskPrioritySchema,
  TaskActions: taskActionsSchema,
  TaskSummary: taskSummarySchema,
  Task: taskSchema,
  TaskPage: taskPageSchema,
  AssignableUser: assignableUserSchema,
  AssignableUserPage: assignableUserPageSchema,
  Card: cardSchema,
  Board: boardSchema,
  ColumnPage: columnPageSchema,
};

const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
const tooMany = problemResponse(
  'Limite excedido: tasks.create.user.hour ou tasks.write.user.hour (Retry-After)',
);
const unauthenticated = problemResponse('Não autenticado ou sessão encerrada');
const forbidden = (detail: string) => problemResponse(`${detail} ou falha de CSRF`);
const taskNotFound = problemResponse(
  'Tarefa inexistente, de outra organização ou de projeto sem acesso — mesma resposta (TASK_NOT_FOUND)',
);
const projectNotFound = problemResponse(
  'Projeto da query ou do corpo inexistente, de outra organização ou sem acesso (PROJECT_NOT_FOUND)',
);
const writeConflict = problemResponse(
  'PROJECT_ARCHIVED, TASK_CANCELED, VERSION_CONFLICT ou CONCURRENT_UPDATE',
);
const tags = ['Tasks'];
const BASE = '/api/v1/organizations/{organizationId}/tasks';
const organizationPath = z.object({ organizationId: z.uuid() });
const taskPath = organizationPath.extend({ taskId: z.uuid() });

/** Rotas de `createTasksRouter` (spec 004). Mantenha em sincronia com o router. */
export const tasksOpenApiPaths: ZodOpenApiPathsObject = {
  [BASE]: {
    get: {
      tags,
      summary: 'Tarefas do projeto por número decrescente, com filtros (project:read; RF-03)',
      security: SECURITY.authenticated,
      requestParams: { path: organizationPath, query: taskListQuerySchema },
      responses: {
        '200': { description: 'Página de tarefas', ...json(taskPageSchema) },
        '400': problemResponse('Consulta inválida'),
        '401': unauthenticated,
        '404': projectNotFound,
      },
    },
    post: {
      tags,
      summary: 'Cria tarefa ou subtarefa (task:create; + task:assign com responsável; BR-028)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: organizationPath },
      requestBody: json(createTaskRequestSchema),
      responses: {
        '201': { description: 'Criada (header Location)', ...json(taskSchema) },
        '400': problemResponse('Título, descrição ou prazo inválidos'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente (INSUFFICIENT_ROLE)'),
        '404': problemResponse('PROJECT_NOT_FOUND, ou pai de outro projeto (TASK_NOT_FOUND)'),
        '409': problemResponse('PROJECT_ARCHIVED'),
        '422': problemResponse(
          'SUBTASK_DEPTH, REQUIRED_WITHOUT_PARENT, PARENT_TASK_COMPLETED, ASSIGNEE_NOT_PROJECT_MEMBER, TASK_LIMIT_REACHED ou SUBTASK_LIMIT_REACHED',
        ),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/assignable-users`]: {
    get: {
      tags,
      summary: 'Quem pode ser responsável: papel efetivo manager/member (task:assign; BR-003)',
      security: SECURITY.authenticated,
      requestParams: { path: organizationPath, query: assignableUsersQuerySchema },
      responses: {
        '200': { description: 'Página de candidatos', ...json(assignableUserPageSchema) },
        '400': problemResponse('Consulta inválida'),
        '401': unauthenticated,
        '403': problemResponse('Papel insuficiente (INSUFFICIENT_ROLE)'),
        '404': projectNotFound,
      },
    },
  },
  [`${BASE}/by-key/{key}`]: {
    get: {
      tags,
      summary: 'Tarefa pela chave CHAVE-N (BR-028), com subtarefas, dependências e ações',
      security: SECURITY.authenticated,
      requestParams: { path: organizationPath.extend({ key: z.string() }) },
      responses: {
        '200': { description: 'Tarefa', ...json(taskSchema) },
        '401': unauthenticated,
        '404': taskNotFound,
      },
    },
  },
  [`${BASE}/{taskId}`]: {
    get: {
      tags,
      summary: 'Tarefa com subtarefas, dependências (bloqueia até 50), transições e ações (RF-04)',
      security: SECURITY.authenticated,
      requestParams: { path: taskPath },
      responses: {
        '200': { description: 'Tarefa', ...json(taskSchema) },
        '401': unauthenticated,
        '404': taskNotFound,
      },
    },
    patch: {
      tags,
      summary: 'Edita campos e a marca "obrigatória" (task:update; BR-008, BR-029, BR-001)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: taskPath },
      requestBody: json(updateTaskRequestSchema),
      responses: {
        '200': { description: 'Atualizada', ...json(taskSchema) },
        '400': problemResponse('Dados inválidos'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': taskNotFound,
        '409': writeConflict,
        '422': problemResponse(
          'REQUIRED_WITHOUT_PARENT, PARENT_TASK_COMPLETED ou DEPENDENCY_CYCLE',
        ),
        '429': tooMany,
      },
    },
    delete: {
      tags,
      summary:
        'Exclui com subtarefas e dependências (task:delete; member: tarefa e subtarefas dele — D5)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: taskPath, query: deleteTaskQuerySchema },
      responses: {
        '204': { description: 'Excluída' },
        '400': problemResponse('Versão ausente'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': taskNotFound,
        '409': problemResponse('PROJECT_ARCHIVED ou VERSION_CONFLICT'),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/{taskId}/assignee`]: {
    put: {
      tags,
      summary: 'Atribui ou desatribui (null) o responsável (task:assign; BR-003)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: taskPath },
      requestBody: json(assignTaskRequestSchema),
      responses: {
        '200': { description: 'Atribuída', ...json(taskSchema) },
        '400': problemResponse('Dados inválidos'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': taskNotFound,
        '409': writeConflict,
        '422': problemResponse('ASSIGNEE_NOT_PROJECT_MEMBER'),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/{taskId}/transition`]: {
    post: {
      tags,
      summary: 'Muda o status pelo workflow (task:update; BR-004, BR-001, BR-006)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: taskPath },
      requestBody: json(transitionTaskRequestSchema),
      responses: {
        '200': { description: 'Movida', ...json(taskSchema) },
        '400': problemResponse('Dados inválidos'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': problemResponse('TASK_NOT_FOUND ou STATUS_NOT_FOUND'),
        '409': writeConflict,
        '422': problemResponse(
          'TRANSITION_NOT_ALLOWED, PARENT_TASK_COMPLETED, TASK_HAS_PENDING_REQUIRED_SUBTASKS ou TASK_BLOCKED_BY_DEPENDENCIES (com taskIds)',
        ),
        '429': tooMany,
      },
    },
  },
  ...Object.fromEntries(
    (['cancel', 'reopen'] as const).map((action) => [
      `${BASE}/{taskId}/${action}`,
      {
        post: {
          tags,
          summary:
            action === 'cancel'
              ? 'Cancela (task:update; idempotente; BR-029)'
              : 'Reabre (task:update; idempotente; BR-029, BR-001)',
          security: SECURITY.authenticatedWithCsrf,
          requestParams: { path: taskPath },
          requestBody: json(taskVersionRequestSchema),
          responses: {
            '200': { description: 'Tarefa', ...json(taskSchema) },
            '401': unauthenticated,
            '403': forbidden('Papel insuficiente'),
            '404': taskNotFound,
            '409': problemResponse('PROJECT_ARCHIVED ou VERSION_CONFLICT'),
            '422': problemResponse(
              'PARENT_TASK_COMPLETED ou TASK_HAS_PENDING_REQUIRED_SUBTASKS (reabrir)',
            ),
            '429': tooMany,
          },
        },
      },
    ]),
  ),
  [`${BASE}/{taskId}/dependencies`]: {
    post: {
      tags,
      summary: 'Bloqueada por outra tarefa do mesmo projeto (task:update; BR-006, D4)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: taskPath },
      requestBody: json(addDependencyRequestSchema),
      responses: {
        '201': { description: 'Dependência criada', ...json(taskSchema) },
        '200': { description: 'Já existia (idempotente)', ...json(taskSchema) },
        '400': problemResponse('Dados inválidos'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': problemResponse('TASK_NOT_FOUND (tarefa ou bloqueadora de outro projeto)'),
        '409': problemResponse('PROJECT_ARCHIVED ou TASK_CANCELED'),
        '422': problemResponse('DEPENDENCY_CYCLE ou DEPENDENCY_LIMIT_REACHED'),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/{taskId}/dependencies/{blockingTaskId}`]: {
    delete: {
      tags,
      summary: 'Remove a dependência (task:update)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: taskPath.extend({ blockingTaskId: z.uuid() }) },
      responses: {
        '204': { description: 'Removida' },
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': problemResponse('TASK_NOT_FOUND ou DEPENDENCY_NOT_FOUND'),
        '409': problemResponse('PROJECT_ARCHIVED ou TASK_CANCELED'),
        '429': tooMany,
      },
    },
  },
  ['/api/v1/organizations/{organizationId}/board']: {
    get: {
      tags: ['Board'],
      summary:
        'Quadro do projeto: uma coluna por status, cards por (posição, id) (project:read; RF-01)',
      security: SECURITY.authenticated,
      requestParams: { path: organizationPath, query: boardQuerySchema },
      responses: {
        '200': { description: 'Quadro', ...json(boardSchema) },
        '400': problemResponse('Consulta inválida'),
        '401': unauthenticated,
        '404': projectNotFound,
      },
    },
  },
  ['/api/v1/organizations/{organizationId}/board/columns/{statusId}']: {
    get: {
      tags: ['Board'],
      summary: 'Mais cards de uma coluna (cursor amarrado à coluna)',
      security: SECURITY.authenticated,
      requestParams: {
        path: organizationPath.extend({ statusId: z.uuid() }),
        query: columnQuerySchema,
      },
      responses: {
        '200': { description: 'Página da coluna', ...json(columnPageSchema) },
        '400': problemResponse('Consulta ou cursor inválidos (INVALID_CURSOR)'),
        '401': unauthenticated,
        '404': problemResponse('PROJECT_NOT_FOUND ou STATUS_NOT_FOUND'),
      },
    },
  },
  [`${BASE}/{taskId}/move`]: {
    post: {
      tags: ['Board'],
      summary: 'Move o card: reordena ou muda de coluna pelo fluxo (task:update; BR-009, BR-004)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: taskPath },
      requestBody: json(moveCardRequestSchema),
      responses: {
        '200': { description: 'Card movido', ...json(moveCardResponseSchema) },
        '400': problemResponse('Dados inválidos (inclusive os dois vizinhos juntos)'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': problemResponse('TASK_NOT_FOUND ou STATUS_NOT_FOUND'),
        '409': writeConflict,
        '422': problemResponse(
          'TASK_NOT_A_CARD, INVALID_POSITION, TRANSITION_NOT_ALLOWED, TASK_HAS_PENDING_REQUIRED_SUBTASKS ou TASK_BLOCKED_BY_DEPENDENCIES (com taskIds)',
        ),
        '429': tooMany,
      },
    },
  },
};
