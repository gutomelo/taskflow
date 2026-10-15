import type { Response } from 'express';

/** Access token: enviado em toda requisição à API (ADR 0005). */
export const ACCESS_TOKEN_COOKIE = '__Host-tf_at';
/** Refresh token: path restrito às rotas de autenticação; `__Secure-` permite o path (ADR 0005). */
export const REFRESH_TOKEN_COOKIE = '__Secure-tf_rt';
export const REFRESH_TOKEN_COOKIE_PATH = '/api/v1/auth';

export type SessionCredentials = Readonly<{
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}>;

/** Prefixos `__Host-`/`__Secure-` exigem `Secure`; localhost é contexto seguro nos navegadores. */
export function setSessionCookies(response: Response, credentials: SessionCredentials): void {
  response.cookie(ACCESS_TOKEN_COOKIE, credentials.accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    // O cookie vive tanto quanto a sessão; o JWT dentro dele continua expirando em 15 min
    // (verificado no servidor). Se o navegador o apagasse junto com o JWT, refresh e logout
    // perderiam o `sid` que vincula o token CSRF e responderiam 403 (T29/B1).
    expires: credentials.refreshTokenExpiresAt,
  });
  response.cookie(REFRESH_TOKEN_COOKIE, credentials.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: REFRESH_TOKEN_COOKIE_PATH,
    expires: credentials.refreshTokenExpiresAt,
  });
}

/** Remove os cookies de sessão (mesmos atributos de path, senão o navegador os mantém). */
export function clearSessionCookies(response: Response): void {
  response.clearCookie(ACCESS_TOKEN_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
  response.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: REFRESH_TOKEN_COOKIE_PATH,
  });
}
