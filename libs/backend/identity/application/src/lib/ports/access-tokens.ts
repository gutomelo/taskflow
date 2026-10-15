/** Claims mínimas do access token (ADR 0005): nada mutável como papel ou verificação de e-mail. */
export type AccessTokenSubject = Readonly<{
  userId: string;
  sessionId: string;
}>;

export type IssuedAccessToken = Readonly<{
  token: string;
  expiresAt: Date;
}>;

export interface AccessTokenIssuer {
  issue(subject: AccessTokenSubject): Promise<IssuedAccessToken>;
}

export interface AccessTokenVerifyOptions {
  /**
   * Aceita token expirado (assinatura e demais claims continuam obrigatórias). Uso restrito:
   * descobrir a sessão para o vínculo CSRF da rota de refresh (spec 001, T16).
   */
  readonly ignoreExpiration?: boolean;
}

export interface AccessTokenVerifier {
  /** Retorna `null` para qualquer token inválido; nunca lança por token ruim. */
  verify(token: string, options?: AccessTokenVerifyOptions): Promise<AccessTokenSubject | null>;
}
