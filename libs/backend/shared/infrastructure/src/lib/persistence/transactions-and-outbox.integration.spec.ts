import { createIntegrationEvent } from '@taskflow/backend/shared/application';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '../../testing';
import { PrismaOutboxWriter } from '../events/prisma-outbox-writer';
import { UuidV7Generator } from '../identity/uuid-v7-generator';
import { SystemClock } from '../time/system-clock';
import { createPrismaClient, type PrismaClient } from './prisma-client.factory';
import { PrismaTransactionRunner, TransactionRequiredError } from './prisma-transaction-runner';

describe('PrismaTransactionRunner + PrismaOutboxWriter (integration)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let outbox: PrismaOutboxWriter;
  const dependencies = { idGenerator: new UuidV7Generator(), clock: new SystemClock() };

  const newEvent = (type = 'test.happened') =>
    createIntegrationEvent(type, { userId: 'user-1' }, dependencies);

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma);
    outbox = new PrismaOutboxWriter(transactions);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany();
  });

  it('applies the migrations, including the partial index for unpublished events', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'outbox_events_unpublished_idx'`;

    expect(indexes[0]?.indexdef).toContain('WHERE (published_at IS NULL)');
  });

  it('persists outbox events written inside a committed transaction', async () => {
    const event = newEvent();

    await transactions.run(() => outbox.append([event]));

    const stored = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored).toMatchObject({
      type: 'test.happened',
      payload: { userId: 'user-1' },
      publishedAt: null,
    });
    expect(stored.occurredAt.toISOString()).toBe(event.occurredAt.toISOString());
  });

  it('discards outbox events when the transaction rolls back (BR-010)', async () => {
    const failure = new Error('business update failed after the event was recorded');

    await expect(
      transactions.run(async () => {
        await outbox.append([newEvent()]);
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('joins the outer transaction on nested runs, so an inner failure rolls back everything', async () => {
    await expect(
      transactions.run(async () => {
        await outbox.append([newEvent('outer.event')]);
        await transactions.run(async () => {
          await outbox.append([newEvent('inner.event')]);
          throw new Error('inner failure');
        });
      }),
    ).rejects.toThrow('inner failure');

    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('reuses the outer transaction client in nested runs (no savepoints)', async () => {
    await transactions.run(async () => {
      const outerClient = transactions.client();
      await transactions.run(async () => {
        expect(transactions.client()).toBe(outerClient);
      });
    });
  });

  it('refuses to write to the outbox outside a transaction', async () => {
    await expect(outbox.append([newEvent()])).rejects.toBeInstanceOf(TransactionRequiredError);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('isolates concurrent transactions: uncommitted rows are invisible to other connections', async () => {
    let releaseTransaction: () => void = () => undefined;
    const holdOpen = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    const event = newEvent();

    const pending = transactions.run(async () => {
      await outbox.append([event]);
      await holdOpen;
    });
    await vi.waitFor(async () => {
      const visibleInside = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'`;
      expect(Number(visibleInside[0]?.count)).toBeGreaterThan(0);
    });

    expect(await prisma.outboxEvent.count()).toBe(0);
    releaseTransaction();
    await pending;
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('uses the plain client outside transactions and the transaction client inside', async () => {
    expect(transactions.client()).toBe(prisma);
    await transactions.run(async () => {
      expect(transactions.client()).not.toBe(prisma);
    });
  });
});
