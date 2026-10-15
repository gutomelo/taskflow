/** Evento de segurança: só identificadores e valores não sensíveis — nunca tokens, senhas ou e-mail em claro. */
export type SecurityEventBase = Readonly<{ type: string }>;

/**
 * Registro de eventos de segurança (logger estruturado, ligado no composition root). Porta
 * compartilhada: cada contexto define a união dos seus eventos (`identity`, `organizations`…).
 */
export interface SecurityEventRecorder<TEvent extends SecurityEventBase = SecurityEventBase> {
  record(event: TEvent): void;
}
