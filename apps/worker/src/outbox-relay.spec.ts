import type { Queue } from 'bullmq';
import { pino } from 'pino';
import {
  SystemClock,
  type OutboxJobData,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import { createOutboxRelay } from './outbox-relay';

// A composição falha antes de tocar banco ou fila: objetos vazios bastam para estes casos.
const prisma = {} as PrismaClient;
const queue = {} as Queue<OutboxJobData>;

describe('single outbox relay (ADR 0017)', () => {
  const relay = (...routes: Array<Map<string, Queue<OutboxJobData>>>) =>
    createOutboxRelay({
      prisma,
      routes,
      clock: new SystemClock(),
      logger: pino({ level: 'silent' }),
    });

  it('refuses an event type routed by two pipelines (it would be delivered twice)', () => {
    expect(() =>
      relay(
        new Map([['tasks.assignee_changed', queue]]),
        new Map([['tasks.assignee_changed', queue]]),
      ),
    ).toThrow('Outbox event type "tasks.assignee_changed" routed twice');
  });

  it('accepts disjoint pipelines', () => {
    expect(() =>
      relay(new Map([['identity.x', queue]]), new Map([['tasks.assignee_changed', queue]])),
    ).not.toThrow();
  });
});
