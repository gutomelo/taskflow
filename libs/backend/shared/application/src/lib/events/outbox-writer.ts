import type { IntegrationEvent } from './integration-event';

/**
 * Grava eventos de integração na outbox. Deve ser chamado dentro de
 * `TransactionRunner.run` para que o evento só exista se a alteração de negócio
 * for confirmada (ADR 0011); implementações falham se não houver transação ativa.
 */
export interface OutboxWriter {
  append(events: ReadonlyArray<IntegrationEvent>): Promise<void>;
}
