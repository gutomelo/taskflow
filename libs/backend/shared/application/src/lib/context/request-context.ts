/** Usuário autenticado que executa a operação. */
export type Actor = Readonly<{
  userId: string;
  sessionId: string;
}>;

/**
 * Contexto de uma operação autenticada, montado pela camada HTTP a partir da sessão
 * verificada e passado explicitamente aos casos de uso (nunca lido de estado global).
 * Contextos tenant-scoped estendem este tipo na própria `application` (spec 002).
 */
export type RequestContext = Readonly<{
  requestId: string;
  actor: Actor;
}>;
