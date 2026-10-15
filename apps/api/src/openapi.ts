import { createApiDocument, type ApiDocument } from '@taskflow/backend/shared/http';
import { identityOpenApiPaths, identityOpenApiSchemas } from '@taskflow/backend/identity/http';
import {
  organizationsOpenApiPaths,
  organizationsOpenApiSchemas,
} from '@taskflow/backend/organizations/http';
import { projectsOpenApiPaths, projectsOpenApiSchemas } from '@taskflow/backend/projects/http';
import { tasksOpenApiPaths, tasksOpenApiSchemas } from '@taskflow/backend/tasks/http';
import {
  collaborationOpenApiPaths,
  collaborationOpenApiSchemas,
} from '@taskflow/backend/collaboration/http';
import {
  notificationsOpenApiPaths,
  notificationsOpenApiSchemas,
} from '@taskflow/backend/notifications/http';
import { healthOpenApiPaths } from './health/health.openapi';

/** Documento OpenAPI 3.1 da API, composto pelas rotas de cada módulo (RF-14). */
export function createTaskflowApiDocument(): ApiDocument {
  return createApiDocument({
    title: 'TaskFlow API',
    version: '0.1.0',
    description:
      'API do TaskFlow. Autenticação por cookies HttpOnly; mutações exigem o header X-CSRF-Token ' +
      'com o valor do cookie __Host-tf_csrf (obtido em GET /api/v1/auth/csrf). Erros seguem RFC 9457.',
    paths: [
      healthOpenApiPaths,
      identityOpenApiPaths,
      organizationsOpenApiPaths,
      projectsOpenApiPaths,
      tasksOpenApiPaths,
      collaborationOpenApiPaths,
      notificationsOpenApiPaths,
    ],
    schemas: {
      ...identityOpenApiSchemas,
      ...organizationsOpenApiSchemas,
      ...projectsOpenApiSchemas,
      ...tasksOpenApiSchemas,
      ...collaborationOpenApiSchemas,
      ...notificationsOpenApiSchemas,
    },
  });
}
