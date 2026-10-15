import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { livenessReportSchema, readinessReportSchema } from '@taskflow/contracts';

const tags = ['Operação'];

/** Endpoints operacionais (fora de `/api/v1`, sem versão). */
export const healthOpenApiPaths: ZodOpenApiPathsObject = {
  '/health/live': {
    get: {
      tags,
      summary: 'Processo vivo (não consulta dependências)',
      responses: {
        '200': {
          description: 'Vivo',
          content: { 'application/json': { schema: livenessReportSchema } },
        },
      },
    },
  },
  '/health/ready': {
    get: {
      tags,
      summary: 'Pronto para tráfego: PostgreSQL e Redis',
      responses: {
        '200': {
          description: 'Pronto',
          content: { 'application/json': { schema: readinessReportSchema } },
        },
        '503': {
          description: 'Alguma dependência indisponível',
          content: { 'application/json': { schema: readinessReportSchema } },
        },
      },
    },
  },
};
