// Fakes genéricos para testes de casos de uso de qualquer contexto. Nunca em produção.
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import type {
  EmailMessage,
  EmailSender,
  IntegrationEvent,
  OutboxWriter,
  Pseudonymizer,
  RateLimitDecision,
  RateLimitPolicy,
  RateLimiter,
  TransactionOptions,
  TransactionRunner,
} from '../index';

/** Participante de transação com estado copiável (simula o rollback do banco). */
export interface TransactionalStore {
  snapshot(): unknown;
  restore(state: unknown): void;
}

export class FakeTransactionRunner implements TransactionRunner {
  private readonly stores: TransactionalStore[] = [];
  private depth = 0;
  commits = 0;
  rollbacks = 0;

  register(...stores: TransactionalStore[]): void {
    this.stores.push(...stores);
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  /** Opções de cada transação externa (ex.: `lockTimeoutMs`), na ordem. */
  readonly options: Array<TransactionOptions | undefined> = [];

  async run<T>(work: () => Promise<T>, options?: TransactionOptions): Promise<T> {
    if (this.depth > 0) return work();
    this.options.push(options);
    const saved = this.stores.map((store) => store.snapshot());
    this.depth += 1;
    try {
      const result = await work();
      this.commits += 1;
      return result;
    } catch (error) {
      this.stores.forEach((store, index) => store.restore(saved[index]));
      this.rollbacks += 1;
      throw error;
    } finally {
      this.depth -= 1;
    }
  }
}

export class FixedClock implements Clock {
  constructor(private current = new Date('2026-10-08T12:00:00.000Z')) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SequentialIds implements IdGenerator {
  private next = 0;
  generate(): string {
    this.next += 1;
    return `00000000-0000-7000-8000-${String(this.next).padStart(12, '0')}`;
  }
}

export class InMemoryOutbox implements OutboxWriter, TransactionalStore {
  events: IntegrationEvent[] = [];

  constructor(private readonly transactions: FakeTransactionRunner) {}

  snapshot() {
    return [...this.events];
  }
  restore(state: unknown) {
    this.events = state as IntegrationEvent[];
  }
  async append(events: ReadonlyArray<IntegrationEvent>) {
    if (!this.transactions.inTransaction) throw new Error('Outbox requires a transaction');
    this.events.push(...events);
  }
  types(): string[] {
    return this.events.map((event) => event.type);
  }
}

export class InMemoryRateLimiter implements RateLimiter {
  consumed = new Map<string, number>();
  async consume(policy: RateLimitPolicy, key: string): Promise<RateLimitDecision> {
    const id = `${policy.name}|${key}`;
    const used = (this.consumed.get(id) ?? 0) + 1;
    this.consumed.set(id, used);
    return used <= policy.points
      ? { allowed: true, remainingPoints: policy.points - used }
      : { allowed: false, retryAfterSeconds: policy.durationSeconds };
  }
  async reset(policy: RateLimitPolicy, key: string) {
    this.consumed.delete(`${policy.name}|${key}`);
  }
  keys(): string[] {
    return [...this.consumed.keys()];
  }
}

export const fakePseudonymizer: Pseudonymizer = {
  pseudonymize: (value) =>
    `pseudo(${value.length})#${[...value].reduce((sum, char) => sum + char.charCodeAt(0), 0)}`,
};

/** Grava as mensagens enviadas; `failNext(n)` simula falhas de SMTP (o job faria retry). */
export class RecordingEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  readonly attempted: EmailMessage[] = [];
  private failuresLeft = 0;

  failNext(times = 1) {
    this.failuresLeft = times;
  }
  async send(message: EmailMessage) {
    this.attempted.push(message);
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error('SMTP unavailable');
    }
    this.sent.push(message);
  }
}
