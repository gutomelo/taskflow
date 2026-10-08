import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';

/** Valor serializável em JSON — payloads atravessam banco (outbox) e fila. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

/**
 * Evento publicado para fora do processo (outbox → fila). Contrato estável:
 * contém apenas identificadores e dados não sensíveis — nunca tokens ou senhas.
 */
export type IntegrationEvent<
  TType extends string = string,
  TPayload extends { readonly [key: string]: JsonValue } = { readonly [key: string]: JsonValue },
> = Readonly<{
  id: string;
  type: TType;
  occurredAt: Date;
  payload: Readonly<TPayload>;
}>;

export interface IntegrationEventFactoryDependencies {
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export function createIntegrationEvent<
  TType extends string,
  TPayload extends { readonly [key: string]: JsonValue },
>(
  type: TType,
  payload: TPayload,
  { idGenerator, clock }: IntegrationEventFactoryDependencies,
): IntegrationEvent<TType, TPayload> {
  return Object.freeze({
    id: idGenerator.generate(),
    type,
    occurredAt: clock.now(),
    payload: Object.freeze({ ...payload }),
  });
}
