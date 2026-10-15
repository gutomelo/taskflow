import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { Clock } from '@taskflow/backend/shared/kernel';
import {
  BullMqEventPublisher,
  OutboxRelay,
  PrismaTransactionRunner,
  type OutboxJobData,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';

/** Tipo de evento da outbox → fila que o consome. */
export type OutboxRoutes = ReadonlyMap<string, Queue<OutboxJobData>>;

export interface OutboxRelayDependencies {
  readonly prisma: PrismaClient;
  /** Rotas de todos os pipelines (`emails`, `notifications`); um tipo, uma fila. */
  readonly routes: ReadonlyArray<OutboxRoutes>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly pollIntervalMs?: number;
}

/**
 * Relay **único** da outbox no worker (ADR 0017, spec 008 S1): um só leitor da tabela, com o
 * publicador roteando cada tipo para a sua fila (`jobId = eventId`). Tipo sem rota fica pendente.
 */
export function createOutboxRelay(deps: OutboxRelayDependencies): OutboxRelay {
  const routes = new Map<string, Queue<OutboxJobData>>();
  for (const pipeline of deps.routes) {
    for (const [type, queue] of pipeline) {
      // Dois pipelines no mesmo tipo seria entrega em duplicidade: erro de composição.
      if (routes.has(type)) throw new Error(`Outbox event type "${type}" routed twice`);
      routes.set(type, queue);
    }
  }
  return new OutboxRelay({
    transactions: new PrismaTransactionRunner(deps.prisma),
    publisher: new BullMqEventPublisher(routes),
    clock: deps.clock,
    logger: deps.logger,
    ...(deps.pollIntervalMs === undefined ? {} : { pollIntervalMs: deps.pollIntervalMs }),
  });
}
