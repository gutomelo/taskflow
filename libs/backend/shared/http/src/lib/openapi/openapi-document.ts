import { createDocument, type ZodOpenApiPathsObject } from 'zod-openapi';
import type { ZodType } from 'zod';
import { problemDetailsSchema, PROBLEM_CONTENT_TYPE } from '@taskflow/contracts';
import { CSRF_HEADER_NAME } from '../csrf/csrf';

/** Esquemas de segurança: sessão por cookie HttpOnly e token CSRF em header (ADR 0005). */
export const SECURITY_SCHEMES = {
  sessionCookie: {
    type: 'apiKey',
    in: 'cookie',
    name: '__Host-tf_at',
    description: 'Access token JWT em cookie HttpOnly (renovado via /api/v1/auth/refresh).',
  },
  csrfToken: {
    type: 'apiKey',
    in: 'header',
    name: 'X-CSRF-Token',
    description:
      'Obrigatório em métodos não seguros: valor do cookie __Host-tf_csrf (double-submit).',
  },
} as const;

/** Requisitos de segurança reutilizáveis nas operações. */
type SecurityRequirements = Array<Record<string, string[]>>;

export const SECURITY: Readonly<
  Record<'csrf' | 'authenticated' | 'authenticatedWithCsrf', SecurityRequirements>
> = {
  csrf: [{ csrfToken: [] }],
  authenticated: [{ sessionCookie: [] }],
  authenticatedWithCsrf: [{ sessionCookie: [], csrfToken: [] }],
};

/** Resposta de erro padronizada (RFC 9457). */
export function problemResponse(description: string) {
  return {
    description,
    content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
  };
}

export interface ApiDocumentOptions {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly paths: ReadonlyArray<ZodOpenApiPathsObject>;
  /** Schemas registrados como componentes reutilizáveis (`#/components/schemas/<nome>`). */
  readonly schemas?: Readonly<Record<string, ZodType>>;
}

/** Documento OpenAPI 3.1 gerado a partir dos schemas Zod de `@taskflow/contracts` (fonte única). */
export type ApiDocument = ReturnType<typeof createDocument>;

export function createApiDocument(options: ApiDocumentOptions): ApiDocument {
  return createDocument({
    openapi: '3.1.0',
    info: {
      title: options.title,
      version: options.version,
      ...(options.description ? { description: options.description } : {}),
    },
    paths: Object.assign({}, ...options.paths),
    components: {
      securitySchemes: SECURITY_SCHEMES,
      schemas: { ProblemDetails: problemDetailsSchema, ...options.schemas },
    },
  });
}

export { CSRF_HEADER_NAME };
