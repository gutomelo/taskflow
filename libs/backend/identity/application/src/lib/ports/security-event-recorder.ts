/** Eventos de segurança (RNF-11): identificadores apenas — nunca tokens, senhas ou e-mail em claro. */
export type SecurityEvent =
  | Readonly<{ type: 'auth.refresh_grace_hit'; userId: string; sessionId: string }>
  | Readonly<{ type: 'auth.refresh_reuse_detected'; userId: string; sessionId: string }>
  | Readonly<{ type: 'auth.session_revoked'; userId: string; sessionId: string; reason: string }>
  | Readonly<{ type: 'auth.password_changed'; userId: string; revokedSessions: number }>
  | Readonly<{ type: 'auth.password_reset_completed'; userId: string; revokedSessions: number }>;

/** Implementado com o logger estruturado no composition root (spec 001, T16). */
export interface SecurityEventRecorder {
  record(event: SecurityEvent): void;
}
