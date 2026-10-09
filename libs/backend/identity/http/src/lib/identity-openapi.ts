import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { problemResponse, SECURITY } from '@taskflow/backend/shared/http';
import {
  changePasswordRequestSchema,
  confirmEmailVerificationRequestSchema,
  currentUserSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  passwordRuleSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  sessionIdParamSchema,
  sessionListSchema,
  sessionSummarySchema,
} from '@taskflow/contracts';

/** Componentes reutilizáveis do contexto identity no documento OpenAPI. */
export const identityOpenApiSchemas = {
  CurrentUser: currentUserSchema,
  SessionSummary: sessionSummarySchema,
  SessionList: sessionListSchema,
  PasswordRule: passwordRuleSchema,
};

const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
const noContent = (description: string) => ({ description });
const tooMany = problemResponse('Limite de tentativas excedido (Retry-After)');
const csrfFailed = problemResponse('Falha de CSRF (Origin/Referer/Sec-Fetch-Site ou token)');
const unauthenticated = problemResponse('Não autenticado ou sessão encerrada');
const tags = ['Identity & Access'];

/** Rotas de `createIdentityRouter` (spec 001). Mantenha em sincronia com o router. */
export const identityOpenApiPaths: ZodOpenApiPathsObject = {
  '/api/v1/auth/csrf': {
    get: {
      tags,
      summary: 'Emite o cookie __Host-tf_csrf (double-submit)',
      responses: { '204': noContent('Cookie CSRF emitido') },
    },
  },
  '/api/v1/auth/register': {
    post: {
      tags,
      summary: 'Cadastro (resposta idêntica exista ou não a conta — BR-014)',
      security: SECURITY.csrf,
      requestBody: json(registerRequestSchema),
      responses: {
        '202': noContent(
          'Pedido aceito; e-mail de verificação ou aviso enviado de forma assíncrona',
        ),
        '400': problemResponse('Dados inválidos'),
        '403': csrfFailed,
        '422': problemResponse('Senha fora da política (BR-011): regras em `violations`'),
        '429': tooMany,
      },
    },
  },
  '/api/v1/auth/login': {
    post: {
      tags,
      summary: 'Login (define cookies de sessão; atraso progressivo por conta — BR-018)',
      security: SECURITY.csrf,
      requestBody: json(loginRequestSchema),
      responses: {
        '200': { description: 'Autenticado', ...json(currentUserSchema) },
        '401': problemResponse('E-mail ou senha incorretos (mensagem única)'),
        '403': csrfFailed,
        '429': tooMany,
        '503': problemResponse('Capacidade de hash esgotada momentaneamente'),
      },
    },
  },
  '/api/v1/auth/refresh': {
    post: {
      tags,
      summary: 'Renova a sessão com refresh token rotativo (BR-012)',
      security: SECURITY.csrf,
      responses: {
        '204': noContent('Cookies renovados'),
        '401': problemResponse('Sessão revogada (inclui reuso detectado) ou expirada'),
        '409': problemResponse('Renovação concorrente em andamento: repita a requisição original'),
        '429': tooMany,
      },
    },
  },
  '/api/v1/auth/logout': {
    post: {
      tags,
      summary: 'Encerra a sessão atual',
      security: SECURITY.csrf,
      responses: { '204': noContent('Sessão encerrada; cookies removidos (Clear-Site-Data)') },
    },
  },
  '/api/v1/auth/email-verification/resend': {
    post: {
      tags,
      summary: 'Reenvia o e-mail de verificação',
      security: SECURITY.authenticatedWithCsrf,
      responses: {
        '202': noContent('Pedido aceito'),
        '401': unauthenticated,
        '409': problemResponse('E-mail já verificado'),
        '429': tooMany,
      },
    },
  },
  '/api/v1/auth/email-verification/confirm': {
    post: {
      tags,
      summary: 'Confirma o e-mail com o token do link (somente pela própria conta — BR-017)',
      security: SECURITY.authenticatedWithCsrf,
      requestBody: json(confirmEmailVerificationRequestSchema),
      responses: {
        '204': noContent('E-mail verificado'),
        '400': problemResponse('Link inválido ou expirado'),
        '401': unauthenticated,
        '403': problemResponse('Link pertence a outra conta'),
        '409': problemResponse('E-mail já verificado'),
        '429': tooMany,
      },
    },
  },
  '/api/v1/auth/password/forgot': {
    post: {
      tags,
      summary: 'Solicita recuperação de senha (resposta idêntica para qualquer e-mail)',
      security: SECURITY.csrf,
      requestBody: json(forgotPasswordRequestSchema),
      responses: {
        '202': noContent('Pedido aceito'),
        '400': problemResponse('Dados inválidos'),
        '429': tooMany,
      },
    },
  },
  '/api/v1/auth/password/reset': {
    post: {
      tags,
      summary: 'Redefine a senha com o token do link (revoga todas as sessões)',
      security: SECURITY.csrf,
      requestBody: json(resetPasswordRequestSchema),
      responses: {
        '204': noContent('Senha redefinida'),
        '400': problemResponse('Link inválido ou expirado'),
        '422': problemResponse('Senha fora da política (BR-011)'),
        '429': tooMany,
      },
    },
  },
  '/api/v1/me': {
    get: {
      tags,
      summary: 'Usuário autenticado',
      security: SECURITY.authenticated,
      responses: {
        '200': { description: 'Usuário atual', ...json(currentUserSchema) },
        '401': unauthenticated,
      },
    },
  },
  '/api/v1/me/password': {
    post: {
      tags,
      summary: 'Troca a senha (revoga as demais sessões e rotaciona a atual — BR-016)',
      security: SECURITY.authenticatedWithCsrf,
      requestBody: json(changePasswordRequestSchema),
      responses: {
        '204': noContent('Senha trocada; novos cookies emitidos'),
        '401': unauthenticated,
        '403': problemResponse('Senha atual incorreta ou falha de CSRF'),
        '422': problemResponse('Senha fora da política (BR-011)'),
        '429': tooMany,
      },
    },
  },
  '/api/v1/me/sessions': {
    get: {
      tags,
      summary: 'Sessões ativas do usuário',
      security: SECURITY.authenticated,
      responses: {
        '200': { description: 'Sessões ativas', ...json(sessionListSchema) },
        '401': unauthenticated,
      },
    },
  },
  '/api/v1/me/sessions/{sessionId}': {
    delete: {
      tags,
      summary: 'Revoga uma sessão (a atual equivale ao logout)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: sessionIdParamSchema },
      responses: {
        '204': noContent('Sessão revogada'),
        '401': unauthenticated,
        '404': problemResponse('Sessão inexistente ou de outro usuário'),
      },
    },
  },
};
