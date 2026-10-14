import { randomUUID } from 'node:crypto';
import { ConcurrentUpdateError } from '@taskflow/backend/shared/application';
import { Prisma } from '../../generated/prisma/client';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '../../testing';
import { createPrismaClient, type PrismaClient } from './prisma-client.factory';
import { PrismaTransactionRunner } from './prisma-transaction-runner';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const conflict = () =>
  new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });

/** Spec 004, T4: repetição em deadlock/conflito e READ COMMITTED explícito. */
describe('PrismaTransactionRunner conflicts (integration, spec 004 T4)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma, { timeoutMs: 10_000 });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  async function organization() {
    const id = randomUUID();
    await prisma.organization.create({
      data: { id, name: 'Acme', slug: `o-${id.slice(0, 8)}`, createdAt: new Date() },
    });
    return id;
  }

  it('runs in READ COMMITTED even if the database default is stricter', async () => {
    // Padrão do banco mais estrito: o runner precisa fixar o nível, não herdá-lo.
    const [current] = await prisma.$queryRaw<
      Array<{ name: string }>
    >`SELECT current_database() AS name`;
    await prisma.$executeRawUnsafe(
      `ALTER DATABASE "${current?.name ?? ''}" SET default_transaction_isolation = 'serializable'`,
    );
    const fresh = createPrismaClient({ databaseUrl: database.connectionUri });
    const strict = new PrismaTransactionRunner(fresh);
    try {
      const [defaultLevel] = await fresh.$queryRaw<Array<{ level: string }>>`
        SELECT current_setting('transaction_isolation') AS level`;
      const [row] = await strict.run(
        () => strict.client().$queryRaw<Array<{ level: string }>>`
          SELECT current_setting('transaction_isolation') AS level`,
      );

      expect(defaultLevel?.level).toBe('serializable');
      expect(row?.level).toBe('read committed');
    } finally {
      await fresh.$disconnect();
      await prisma.$executeRawUnsafe(
        `ALTER DATABASE "${current?.name ?? ''}" RESET default_transaction_isolation`,
      );
    }
  });

  it('a real deadlock is retried once and both transactions finish', async () => {
    const [a, b] = [await organization(), await organization()];
    let attempts = 0;
    const lockInOrder = (first: string, second: string, name: string) =>
      transactions.run(async () => {
        attempts += 1;
        const client = transactions.client();
        await client.$queryRaw`SELECT id FROM organizations WHERE id = ${first}::uuid FOR UPDATE`;
        await sleep(200);
        await client.organization.update({ where: { id: second }, data: { name } });
      });

    await Promise.all([lockInOrder(a, b, 'Primeira'), lockInOrder(b, a, 'Segunda')]);

    expect(attempts).toBe(3);
  });

  it('a conflict that persists becomes ConcurrentUpdateError after one retry', async () => {
    let attempts = 0;

    await expect(
      transactions.run(async () => {
        attempts += 1;
        throw conflict();
      }),
    ).rejects.toBeInstanceOf(ConcurrentUpdateError);
    expect(attempts).toBe(2);
  });

  it('spec 004 (design, Abuso): lockTimeoutMs turns a long lock wait into ConcurrentUpdateError, without retrying', async () => {
    const organizationId = await organization();
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = transactions.run(async () => {
      await transactions.transactionalClient('test')
        .$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      locked();
      await sleep(2_000);
    });
    await isLocked;
    let attempts = 0;
    const started = Date.now();

    const waiting = transactions.run(
      async () => {
        attempts += 1;
        await transactions.transactionalClient('test')
          .$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      },
      { lockTimeoutMs: 200 },
    );

    await expect(waiting).rejects.toBeInstanceOf(ConcurrentUpdateError);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(attempts).toBe(1);
    await holder;
    // Só naquela transação (SET LOCAL): a seguinte volta ao padrão do banco.
    const [setting] = await transactions.run(
      () =>
        transactions.transactionalClient('test').$queryRaw<
          Array<{ lock_timeout: string }>
        >`SHOW lock_timeout`,
    );
    expect(setting?.lock_timeout).toBe('0');
  });

  it('other errors are not retried, and nested runs do not retry on their own', async () => {
    let attempts = 0;
    await expect(
      transactions.run(async () => {
        attempts += 1;
        throw new Error('regra');
      }),
    ).rejects.toThrow('regra');
    expect(attempts).toBe(1);

    let inner = 0;
    await transactions.run(async () => {
      await transactions
        .run(async () => {
          inner += 1;
          throw conflict();
        })
        .catch((error: unknown) =>
          expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError),
        );
    });
    expect(inner).toBe(1);
  });
});
