import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { z } from 'zod';
import { problemResponse, SECURITY } from '@taskflow/backend/shared/http';
import {
  addProjectMemberRequestSchema,
  changeProjectMemberRoleRequestSchema,
  createProjectRequestSchema,
  createStatusRequestSchema,
  memberCandidatePageSchema,
  memberCandidateSchema,
  pageQuerySchema,
  projectListQuerySchema,
  projectMemberPageSchema,
  projectMemberSchema,
  projectPageSchema,
  projectPermissionSchema,
  projectRoleSchema,
  projectSchema,
  projectSummarySchema,
  projectVersionRequestSchema,
  removeProjectMemberQuerySchema,
  removeStatusQuerySchema,
  reorderStatusesRequestSchema,
  replaceTransitionsRequestSchema,
  statusCategorySchema,
  updateProjectRequestSchema,
  updateStatusRequestSchema,
  workflowSchema,
} from '@taskflow/contracts';

/** Componentes reutilizáveis do contexto projects no documento OpenAPI. */
export const projectsOpenApiSchemas = {
  ProjectRole: projectRoleSchema,
  ProjectPermission: projectPermissionSchema,
  StatusCategory: statusCategorySchema,
  Project: projectSchema,
  ProjectSummary: projectSummarySchema,
  ProjectPage: projectPageSchema,
  Workflow: workflowSchema,
  ProjectMember: projectMemberSchema,
  ProjectMemberPage: projectMemberPageSchema,
  MemberCandidate: memberCandidateSchema,
  MemberCandidatePage: memberCandidatePageSchema,
};

const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
const tooMany = problemResponse('Limite excedido (Retry-After)');
const unauthenticated = problemResponse('Não autenticado ou sessão encerrada');
const forbidden = (detail: string) => problemResponse(`${detail} ou falha de CSRF`);
const notFound = problemResponse(
  'Organização sem membership, projeto inexistente, de outra organização ou sem acesso (mesma resposta — BR-023, ADR 0012)',
);
const conflict = (detail: string) => problemResponse(detail);
const tags = ['Projects'];
const BASE = '/api/v1/organizations/{organizationId}/projects';
const organizationPath = z.object({ organizationId: z.uuid() });
const projectPath = organizationPath.extend({ projectId: z.uuid() });
const memberPath = projectPath.extend({ userId: z.uuid() });
const statusPath = projectPath.extend({ statusId: z.uuid() });

/** Rotas de `createProjectsRouter` (spec 003). Mantenha em sincronia com o router. */
export const projectsOpenApiPaths: ZodOpenApiPathsObject = {
  [BASE]: {
    get: {
      tags,
      summary: 'Projetos visíveis (owner/admin: todos; demais: os que participam — BR-023)',
      security: SECURITY.authenticated,
      requestParams: { path: organizationPath, query: projectListQuerySchema },
      responses: {
        '200': { description: 'Página de projetos por nome', ...json(projectPageSchema) },
        '400': problemResponse('Consulta inválida'),
        '401': unauthenticated,
        '404': notFound,
      },
    },
    post: {
      tags,
      summary: 'Cria projeto com o workflow padrão (project:create; BR-024, BR-025)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: organizationPath },
      requestBody: json(createProjectRequestSchema),
      responses: {
        '201': { description: 'Criado (header Location)', ...json(projectSchema) },
        '400': problemResponse('Chave, nome ou descrição inválidos (INVALID_PROJECT_KEY…)'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente ou configuração desligada (INSUFFICIENT_ROLE)'),
        '404': notFound,
        '409': conflict('Chave em uso na organização (PROJECT_KEY_TAKEN)'),
        '422': problemResponse('Limite de projetos (PROJECT_LIMIT_REACHED)'),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/by-key/{key}`]: {
    get: {
      tags,
      summary: 'Projeto pela chave (BR-025), com papel efetivo e capacidades',
      security: SECURITY.authenticated,
      requestParams: { path: organizationPath.extend({ key: z.string() }) },
      responses: {
        '200': { description: 'Projeto', ...json(projectSchema) },
        '401': unauthenticated,
        '404': notFound,
      },
    },
  },
  [`${BASE}/{projectId}`]: {
    get: {
      tags,
      summary: 'Projeto com papel efetivo e capacidades',
      security: SECURITY.authenticated,
      requestParams: { path: projectPath },
      responses: {
        '200': { description: 'Projeto', ...json(projectSchema) },
        '401': unauthenticated,
        '404': notFound,
      },
    },
    patch: {
      tags,
      summary: 'Atualiza nome e/ou descrição (project:update; BR-008, BR-026)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: projectPath },
      requestBody: json(updateProjectRequestSchema),
      responses: {
        '200': { description: 'Atualizado', ...json(projectSchema) },
        '400': problemResponse('Dados inválidos'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente (INSUFFICIENT_ROLE)'),
        '404': notFound,
        '409': conflict('PROJECT_ARCHIVED ou VERSION_CONFLICT'),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/{projectId}/archive`]: {
    post: {
      tags,
      summary: 'Arquiva (project:archive; idempotente; BR-026)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: projectPath },
      requestBody: json(projectVersionRequestSchema),
      responses: {
        '200': { description: 'Arquivado', ...json(projectSchema) },
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': notFound,
        '409': conflict('VERSION_CONFLICT'),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/{projectId}/restore`]: {
    post: {
      tags,
      summary: 'Restaura (project:archive; idempotente; BR-026)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: projectPath },
      requestBody: json(projectVersionRequestSchema),
      responses: {
        '200': { description: 'Restaurado', ...json(projectSchema) },
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': notFound,
        '409': conflict('VERSION_CONFLICT'),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/{projectId}/workflow`]: {
    get: {
      tags,
      summary: 'Workflow do projeto (só leitura nesta versão; BR-004)',
      security: SECURITY.authenticated,
      requestParams: { path: projectPath },
      responses: {
        '200': { description: 'Status e transições', ...json(workflowSchema) },
        '401': unauthenticated,
        '404': notFound,
      },
    },
  },
  [`${BASE}/{projectId}/members`]: {
    get: {
      tags,
      summary: 'Participantes com papel efetivo e as ações do usuário atual',
      security: SECURITY.authenticated,
      requestParams: { path: projectPath, query: pageQuerySchema },
      responses: {
        '200': { description: 'Página de participantes', ...json(projectMemberPageSchema) },
        '401': unauthenticated,
        '404': notFound,
      },
    },
    post: {
      tags,
      summary: 'Adiciona membro da organização (project-member:manage; BR-027)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: projectPath },
      requestBody: json(addProjectMemberRequestSchema),
      responses: {
        '201': { description: 'Participante', ...json(projectMemberSchema) },
        '400': problemResponse('Dados inválidos'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': problemResponse(
          'Projeto sem acesso ou pessoa fora da organização (MEMBER_NOT_FOUND)',
        ),
        '409': conflict('ALREADY_A_PROJECT_MEMBER ou PROJECT_ARCHIVED'),
        '422': problemResponse(
          'ALREADY_MANAGES_ALL_PROJECTS, PROJECT_ROLE_ABOVE_CEILING ou PROJECT_MEMBER_LIMIT_REACHED',
        ),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/{projectId}/member-candidates`]: {
    get: {
      tags,
      summary: 'Membros da organização que podem ser adicionados, com os papéis permitidos',
      security: SECURITY.authenticated,
      requestParams: { path: projectPath, query: pageQuerySchema },
      responses: {
        '200': { description: 'Página de candidatos', ...json(memberCandidatePageSchema) },
        '401': unauthenticated,
        '403': problemResponse('Papel insuficiente'),
        '404': notFound,
        '409': conflict('PROJECT_ARCHIVED'),
      },
    },
  },
  [`${BASE}/{projectId}/members/{userId}`]: {
    patch: {
      tags,
      summary: 'Altera o papel de um participante (project-member:manage; BR-008, BR-027)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: memberPath },
      requestBody: json(changeProjectMemberRoleRequestSchema),
      responses: {
        '200': { description: 'Participante', ...json(projectMemberSchema) },
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': problemResponse(
          'Projeto sem acesso ou participante inexistente (PROJECT_MEMBER_NOT_FOUND)',
        ),
        '409': conflict('PROJECT_ARCHIVED ou VERSION_CONFLICT'),
        '422': problemResponse(
          'PROJECT_ROLE_ABOVE_CEILING ou ALREADY_MANAGES_ALL_PROJECTS (participação antiga de quem virou owner/admin)',
        ),
        '429': tooMany,
      },
    },
    delete: {
      tags,
      summary: 'Remove um participante (project-member:manage) ou sai do projeto (o próprio)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: memberPath, query: removeProjectMemberQuerySchema },
      responses: {
        '204': { description: 'Removido' },
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': problemResponse('Projeto sem acesso ou participante inexistente'),
        '409': conflict('VERSION_CONFLICT'),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/{projectId}/workflow/statuses`]: {
    post: {
      tags,
      summary: 'Cria status no fim do fluxo, sem transições (board:configure; BR-030)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: projectPath },
      requestBody: json(createStatusRequestSchema),
      responses: {
        '201': { description: 'Fluxo atualizado', ...json(workflowSchema) },
        '400': problemResponse('Nome inválido (INVALID_STATUS_NAME)'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente (INSUFFICIENT_ROLE)'),
        '404': notFound,
        '409': conflict('PROJECT_ARCHIVED, VERSION_CONFLICT ou STATUS_NAME_TAKEN'),
        '422': problemResponse('STATUS_LIMIT_REACHED'),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/{projectId}/workflow/statuses/{statusId}`]: {
    patch: {
      tags,
      summary: 'Renomeia e/ou muda a categoria (só em status sem tarefas — STATUS_IN_USE)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: statusPath },
      requestBody: json(updateStatusRequestSchema),
      responses: {
        '200': { description: 'Fluxo atualizado', ...json(workflowSchema) },
        '400': problemResponse('Dados inválidos'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': problemResponse('PROJECT_NOT_FOUND ou STATUS_NOT_FOUND'),
        '409': conflict('PROJECT_ARCHIVED, VERSION_CONFLICT, STATUS_NAME_TAKEN ou STATUS_IN_USE'),
        '422': problemResponse('WORKFLOW_NEEDS_TODO_STATUS'),
        '429': tooMany,
      },
    },
    delete: {
      tags,
      summary: 'Remove o status; com tarefas, reatribui a outro da mesma categoria (D2)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: statusPath, query: removeStatusQuerySchema },
      responses: {
        '200': { description: 'Fluxo atualizado', ...json(workflowSchema) },
        '400': problemResponse('Versão ausente'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': problemResponse('PROJECT_NOT_FOUND ou STATUS_NOT_FOUND (inclusive o destino)'),
        '409': conflict('PROJECT_ARCHIVED, VERSION_CONFLICT ou STATUS_IN_USE'),
        '422': problemResponse('INVALID_STATUS_TARGET ou WORKFLOW_NEEDS_TODO_STATUS'),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/{projectId}/workflow/order`]: {
    put: {
      tags,
      summary: 'Nova ordem das colunas (exatamente os status do fluxo)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: projectPath },
      requestBody: json(reorderStatusesRequestSchema),
      responses: {
        '200': { description: 'Fluxo atualizado', ...json(workflowSchema) },
        '400': problemResponse('Dados inválidos'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': problemResponse('PROJECT_NOT_FOUND ou STATUS_NOT_FOUND'),
        '409': conflict('PROJECT_ARCHIVED ou VERSION_CONFLICT'),
        '422': problemResponse('INVALID_STATUS_ORDER'),
        '429': tooMany,
      },
    },
  },
  [`${BASE}/{projectId}/workflow/transitions`]: {
    put: {
      tags,
      summary: 'Substitui as transições permitidas (BR-004)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: projectPath },
      requestBody: json(replaceTransitionsRequestSchema),
      responses: {
        '200': { description: 'Fluxo atualizado', ...json(workflowSchema) },
        '400': problemResponse('Dados inválidos'),
        '401': unauthenticated,
        '403': forbidden('Papel insuficiente'),
        '404': problemResponse('PROJECT_NOT_FOUND ou STATUS_NOT_FOUND'),
        '409': conflict('PROJECT_ARCHIVED ou VERSION_CONFLICT'),
        '422': problemResponse('INVALID_TRANSITION'),
        '429': tooMany,
      },
    },
  },
};
