import { randomUUID } from 'node:crypto';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '../../testing';
import { createPrismaClient, type PrismaClient } from '../persistence/prisma-client.factory';
import { PrismaTransactionRunner } from '../persistence/prisma-transaction-runner';
import { PrismaOutboxRetention } from './prisma-outbox-retention';

const DAY = 24 * 60 * 60 * 1000;

describe('PrismaOutboxRetention (integration)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  async function event(occurredDaysAgo: number, publishedDaysAgo: number | null): Promise<string> {
    const id = randomUUID();
    await prisma.outboxEvent.create({
      data: {
        id,
        type: 'identity.password_reset_requested',
        payload: { email: 'ana@exemplo.com' },
        occurredAt: daysAgo(occurredDaysAgo),
        publishedAt: publishedDaysAgo === null ? null : daysAgo(publishedDaysAgo),
      },
    });
    return id;
  }

  it('deletes events published before the cutoff and never pending ones, in batches', async () => {
    for (let index = 0; index < 3; index += 1) await event(9, 8);
    const publishedRecently = await event(6, 6);
    const pendingForAges = await event(30, null);

    const deleted = await new PrismaOutboxRetention(
      new PrismaTransactionRunner(prisma),
      2,
    ).deletePublishedBefore(daysAgo(7));

    expect(deleted).toBe(3);
    const remaining = (await prisma.outboxEvent.findMany({ select: { id: true } })).map(
      (row) => row.id,
    );
    expect(remaining.sort()).toEqual([publishedRecently, pendingForAges].sort());
  });
});
