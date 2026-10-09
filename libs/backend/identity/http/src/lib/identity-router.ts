import { Router, type Request, type RequestHandler, type Response } from 'express';
import type {
  Pseudonymizer,
  RateLimiter,
  RateLimitPolicy,
} from '@taskflow/backend/shared/application';
import {
  clientIpKey,
  createRateLimit,
  HttpError,
  parseBody,
  readCookie,
  requestContextFrom,
  type CsrfProtection,
} from '@taskflow/backend/shared/http';
import {
  InvalidCredentialsError,
  type AccessTokenVerifier,
  type ChangePasswordUseCase,
  type ConfirmEmailVerificationUseCase,
  type GetCurrentUserUseCase,
  type ListSessionsUseCase,
  type LoginUseCase,
  type LogoutUseCase,
  type RefreshSessionUseCase,
  type RegisterUserUseCase,
  type RequestPasswordResetUseCase,
  type ResendEmailVerificationUseCase,
  type ResetPasswordUseCase,
  type RevokeSessionUseCase,
} from '@taskflow/backend/identity/application';
import {
  changePasswordRequestSchema,
  confirmEmailVerificationRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  sessionIdParamSchema,
  type CurrentUser,
  type SessionList,
} from '@taskflow/contracts';
import { emailKey, IDENTITY_RATE_LIMITS, userKey } from './identity-rate-limits';
import {
  ACCESS_TOKEN_COOKIE,
  clearSessionCookies,
  REFRESH_TOKEN_COOKIE,
  setSessionCookies,
} from './session-cookies';

type Executes<T extends { execute: (...args: never[]) => unknown }> = Pick<T, 'execute'>;

export interface IdentityHttpDependencies {
  readonly useCases: Readonly<{
    register: Executes<RegisterUserUseCase>;
    login: Executes<LoginUseCase>;
    getCurrentUser: Executes<GetCurrentUserUseCase>;
    logout: Executes<LogoutUseCase>;
    refreshSession: Executes<RefreshSessionUseCase>;
    listSessions: Executes<ListSessionsUseCase>;
    revokeSession: Executes<RevokeSessionUseCase>;
    resendEmailVerification: Executes<ResendEmailVerificationUseCase>;
    confirmEmailVerification: Executes<ConfirmEmailVerificationUseCase>;
    changePassword: Executes<ChangePasswordUseCase>;
    requestPasswordReset: Executes<RequestPasswordResetUseCase>;
    resetPassword: Executes<ResetPasswordUseCase>;
  }>;
  readonly csrf: CsrfProtection;
  /** `createAuthenticate` obrigatório e opcional, montados no composition root. */
  readonly authenticate: RequestHandler;
  readonly authenticateOptional: RequestHandler;
  /** Para descobrir a sessão (vínculo CSRF) quando o access token já expirou. */
  readonly accessTokens: AccessTokenVerifier;
  readonly pseudonymizer: Pseudonymizer;
  /** Limites por endpoint (RNF-05); BR-018 é aplicada pelo caso de uso de login. */
  readonly rateLimiter: RateLimiter;
}

const clientInfo = (request: Request) => ({
  ipAddress: request.ip ?? null,
  userAgent: request.get('user-agent') ?? null,
});

const noStore: RequestHandler = (_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
};

/**
 * Rotas `/auth` e `/me` (spec 001). Controllers finos: validam o contrato, chamam um caso de
 * uso e traduzem o resultado em cookies/JSON. Erros de domínio seguem para o error handler.
 */
export function createIdentityRouter(deps: IdentityHttpDependencies): Router {
  const { useCases, csrf } = deps;
  const router = Router();
  const limit = (policy: RateLimitPolicy, key: (request: Request) => string | undefined) =>
    createRateLimit({ limiter: deps.rateLimiter, policy, key });
  const limits = IDENTITY_RATE_LIMITS;
  const byEmail = emailKey(deps.pseudonymizer);

  /** Vínculo CSRF pela sessão do access token, mesmo expirado (refresh e logout). */
  const sessionBinding = async (request: Request): Promise<string> => {
    if (request.actor) return request.actor.sessionId;
    const accessToken = readCookie(request, ACCESS_TOKEN_COOKIE);
    const subject = accessToken
      ? await deps.accessTokens.verify(accessToken, { ignoreExpiration: true })
      : null;
    return subject?.sessionId ?? 'anon';
  };

  router.use(noStore);
  router.use(deps.authenticateOptional);

  // Mesmo vínculo de refresh/logout: com access token expirado, o token CSRF já sai ligado
  // à sessão e o refresh do bootstrap passa (T29/B1).
  router.get('/auth/csrf', async (request, response) => {
    csrf.issue(response, await sessionBinding(request));
    response.status(204).end();
  });

  router.post(
    '/auth/register',
    csrf.require(),
    limit(limits.registerByIp, clientIpKey),
    async (request, response) => {
      await useCases.register.execute(parseBody(request, registerRequestSchema));
      response.status(202).end();
    },
  );

  router.post(
    '/auth/login',
    csrf.require(),
    limit(limits.loginByIp, clientIpKey),
    async (request, response) => {
      const { email, password } = parseBody(request, loginRequestSchema);
      try {
        const result = await useCases.login.execute({
          email,
          password,
          client: clientInfo(request),
        });
        setSessionCookies(response, result);
        csrf.issue(response, result.sessionId);
        request.log.info({
          event: 'auth.login_succeeded',
          userId: result.user.id,
          sessionId: result.sessionId,
        });
        response.status(200).json(result.user satisfies CurrentUser);
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          request.log.warn({
            event: 'auth.login_failed',
            emailPseudonym: deps.pseudonymizer.pseudonymize(email.trim().toLowerCase()),
          });
        }
        throw error;
      }
    },
  );

  router.post(
    '/auth/refresh',
    csrf.require(sessionBinding),
    limit(limits.refreshByIp, clientIpKey),
    async (request, response) => {
      const refreshToken = readCookie(request, REFRESH_TOKEN_COOKIE);
      if (!refreshToken) {
        throw new HttpError(401, 'SESSION_REVOKED', 'Sessão encerrada. Entre novamente.');
      }
      try {
        const result = await useCases.refreshSession.execute({
          refreshToken,
          client: clientInfo(request),
        });
        setSessionCookies(response, result);
        // Sem cookie de access (apagado ou vindo de outro navegador), o CSRF estava ligado a
        // "anon": religa à sessão para as mutações seguintes não falharem com 403 (T29/B1).
        if ((await sessionBinding(request)) !== result.sessionId) {
          csrf.issue(response, result.sessionId);
        }
        response.status(204).end();
      } catch (error) {
        // Sessão definitivamente inválida: remove cookies para o cliente voltar ao login.
        if (isTerminalSessionError(error)) clearSessionCookies(response);
        throw error;
      }
    },
  );

  router.post(
    '/auth/logout',
    csrf.require(sessionBinding),
    limit(limits.logoutByIp, clientIpKey),
    async (request, response) => {
      await useCases.logout.execute({
        sessionId: request.actor?.sessionId ?? null,
        refreshToken: readCookie(request, REFRESH_TOKEN_COOKIE) ?? null,
      });
      endSession(response);
    },
  );

  router.post(
    '/auth/email-verification/resend',
    deps.authenticate,
    csrf.require(),
    limit(limits.resendVerificationByUser, userKey),
    async (request, response) => {
      await useCases.resendEmailVerification.execute(requestContextFrom(request));
      response.status(202).end();
    },
  );

  router.post(
    '/auth/email-verification/confirm',
    deps.authenticate,
    csrf.require(),
    limit(limits.confirmVerificationByUser, userKey),
    async (request, response) => {
      await useCases.confirmEmailVerification.execute(
        requestContextFrom(request),
        parseBody(request, confirmEmailVerificationRequestSchema),
      );
      response.status(204).end();
    },
  );

  router.post(
    '/auth/password/forgot',
    csrf.require(),
    limit(limits.forgotPasswordByIp, clientIpKey),
    limit(limits.forgotPasswordByEmail, byEmail),
    async (request, response) => {
      const { email } = parseBody(request, forgotPasswordRequestSchema);
      await useCases.requestPasswordReset.execute({ email, client: clientInfo(request) });
      response.status(202).end();
    },
  );

  router.post(
    '/auth/password/reset',
    csrf.require(),
    limit(limits.resetPasswordByIp, clientIpKey),
    async (request, response) => {
      await useCases.resetPassword.execute(parseBody(request, resetPasswordRequestSchema));
      // Todas as sessões foram revogadas: limpa cookies eventualmente presentes neste navegador.
      clearSessionCookies(response);
      response.status(204).end();
    },
  );

  router.get('/me', deps.authenticate, async (request, response) => {
    const user = await useCases.getCurrentUser.execute(requestContextFrom(request));
    response.json(user satisfies CurrentUser);
  });

  router.post(
    '/me/password',
    deps.authenticate,
    csrf.require(),
    limit(limits.changePasswordByUser, userKey),
    async (request, response) => {
      const { currentPassword, newPassword } = parseBody(request, changePasswordRequestSchema);
      const result = await useCases.changePassword.execute(requestContextFrom(request), {
        currentPassword,
        newPassword,
        client: clientInfo(request),
      });
      setSessionCookies(response, result);
      csrf.issue(response, result.sessionId);
      response.status(204).end();
    },
  );

  router.get('/me/sessions', deps.authenticate, async (request, response) => {
    const sessions = await useCases.listSessions.execute(requestContextFrom(request));
    const body: SessionList = {
      items: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        device: session.device,
        isCurrent: session.isCurrent,
      })),
    };
    response.json(body);
  });

  router.delete(
    '/me/sessions/:sessionId',
    deps.authenticate,
    csrf.require(),
    async (request, response) => {
      const params = sessionIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new HttpError(404, 'SESSION_NOT_FOUND', 'Sessão não encontrada');
      }
      const context = requestContextFrom(request);
      await useCases.revokeSession.execute(context, params.data.sessionId);
      if (params.data.sessionId === context.actor.sessionId) {
        endSession(response);
        return;
      }
      response.status(204).end();
    },
  );

  return router;
}

function endSession(response: Response): void {
  clearSessionCookies(response);
  // Pede ao navegador que descarte cookies desta origem (inclui o token CSRF).
  response.set('Clear-Site-Data', '"cookies"');
  response.status(204).end();
}

function isTerminalSessionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'SESSION_REVOKED' || error.code === 'SESSION_EXPIRED')
  );
}
