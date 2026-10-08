/**
 * Verificação de disponibilidade de uma dependência externa.
 * `check` resolve quando a dependência responde e rejeita caso contrário.
 * O chamador controla o tempo máximo via `signal`; probes devem liberar
 * recursos (listeners, timers) quando ele for abortado.
 */
export interface DependencyProbe {
  readonly name: string;
  check(signal: AbortSignal): Promise<void>;
}
