import { randomUUID } from 'node:crypto';
import {
  createPrismaClient,
  PrismaTransactionRunner,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import { tokenHash } from '../../testing/identity-test-fixtures';
import { PrismaIdentityDataRetention } from './prisma-identity-data-retention';

const DAY = 24 * 60 * 60 * 1000;

describe('PrismaIdentityDataRetention (integration)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
  const daysAhead = (days: number) => new Date(now.getTime() + days * DAY);

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  async function user(options: { createdDaysAgo: number; verified: boolean }): Promise<string> {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        email: `user-${id}@exemplo.com`,
        name: 'Pessoa',
        passwordHash: '$argon2id$fixture',
        emailVerifiedAt: options.verified ? daysAgo(options.createdDaysAgo) : null,
        passwordChangedAt: daysAgo(options.createdDaysAgo),
        createdAt: daysAgo(options.createdDaysAgo),
      },
    });
    return id;
  }

  async function session(
    userId: string,
    options: {
      createdDaysAgo: number;
      lastUsedDaysAgo?: number;
      idleExpiresAt?: Date;
      absoluteExpiresAt?: Date;
      revokedDaysAgo?: number;
    },
  ): Promise<string> {
    const id = randomUUID();
    const absoluteExpiresAt = options.absoluteExpiresAt ?? daysAhead(30);
    await prisma.session.create({
      data: {
        id,
        userId,
        createdAt: daysAgo(options.createdDaysAgo),
        lastUsedAt: daysAgo(options.lastUsedDaysAgo ?? options.createdDaysAgo),
        idleExpiresAt: options.idleExpiresAt ?? absoluteExpiresAt,
        absoluteExpiresAt,
        ...(options.revokedDaysAgo === undefined
          ? {}
          : { revokedAt: daysAgo(options.revokedDaysAgo), revocationReason: 'logout' as const }),
        refreshTokens: {
          create: {
            id: randomUUID(),
            tokenHash: tokenHash(),
            createdAt: daysAgo(options.createdDaysAgo),
          },
        },
      },
    });
    return id;
  }

  async function userToken(
    userId: string,
    options: { expiresAt: Date; consumedDaysAgo?: number },
  ): Promise<string> {
    const id = randomUUID();
    await prisma.userToken.create({
      data: {
        id,
        userId,
        purpose: 'password_reset',
        tokenHash: tokenHash(),
        sourceEventId: randomUUID(),
        createdAt: new Date(options.expiresAt.getTime() - DAY),
        expiresAt: options.expiresAt,
        consumedAt: options.consumedDaysAgo === undefined ? null : daysAgo(options.consumedDaysAgo),
      },
    });
    return id;
  }

  const sessionIds = async () =>
    (await prisma.session.findMany({ select: { id: true } })).map((row) => row.id);

  it('deletes sessions ended more than the cutoff ago, with their refresh tokens', async () => {
    const owner = await user({ createdDaysAgo: 90, verified: true });
    const revokedLongAgo = await session(owner, { createdDaysAgo: 60, revokedDaysAgo: 31 });
    const idleExpiredLongAgo = await session(owner, {
      createdDaysAgo: 60,
      idleExpiresAt: daysAgo(31),
      absoluteExpiresAt: daysAgo(20),
    });
    const absoluteExpiredLongAgo = await session(owner, {
      createdDaysAgo: 70,
      absoluteExpiresAt: daysAgo(31),
    });
    const revokedRecently = await session(owner, { createdDaysAgo: 40, revokedDaysAgo: 29 });
    const expiredRecently = await session(owner, {
      createdDaysAgo: 40,
      absoluteExpiresAt: daysAgo(29),
    });
    const active = await session(owner, { createdDaysAgo: 1 });

    const deleted = await new PrismaIdentityDataRetention(transactions).deleteSessionsEndedBefore(
      daysAgo(30),
    );

    expect(deleted).toBe(3);
    expect((await sessionIds()).sort()).toEqual([revokedRecently, expiredRecently, active].sort());
    expect(
      await prisma.refreshToken.count({
        where: { sessionId: { in: [revokedLongAgo, idleExpiredLongAgo, absoluteExpiredLongAgo] } },
      }),
    ).toBe(0);
    expect(await prisma.refreshToken.count()).toBe(3);
  });

  it('deletes e-mail tokens consumed or expired more than the cutoff ago', async () => {
    const owner = await user({ createdDaysAgo: 90, verified: true });
    await userToken(owner, { expiresAt: daysAgo(8) });
    await userToken(owner, { expiresAt: daysAgo(9), consumedDaysAgo: 8 });
    const consumedRecently = await userToken(owner, {
      expiresAt: daysAhead(1),
      consumedDaysAgo: 6,
    });
    const expiredRecently = await userToken(owner, { expiresAt: daysAgo(6) });
    const pending = await userToken(owner, { expiresAt: daysAhead(1) });

    const deleted = await new PrismaIdentityDataRetention(transactions).deleteUserTokensEndedBefore(
      daysAgo(7),
    );

    expect(deleted).toBe(2);
    const remaining = (await prisma.userToken.findMany({ select: { id: true } })).map(
      (row) => row.id,
    );
    expect(remaining.sort()).toEqual([consumedRecently, expiredRecently, pending].sort());
  });

  it('removes unverified accounts older than the cutoff without recent login (RF-15)', async () => {
    const abandoned = await user({ createdDaysAgo: 8, verified: false });
    await session(abandoned, { createdDaysAgo: 8 }); // login só no início do período
    await userToken(abandoned, { expiresAt: daysAhead(1) });
    const recentLogin = await user({ createdDaysAgo: 8, verified: false });
    await session(recentLogin, { createdDaysAgo: 2 });
    // T29/I4: entrou há 8 dias e segue usando a mesma sessão (renovada pelo refresh).
    const activeSinceLogin = await user({ createdDaysAgo: 8, verified: false });
    await session(activeSinceLogin, { createdDaysAgo: 8, lastUsedDaysAgo: 0 });
    const young = await user({ createdDaysAgo: 6, verified: false });
    const verified = await user({ createdDaysAgo: 30, verified: true });

    const deleted = await new PrismaIdentityDataRetention(transactions).deleteUnverifiedUsers({
      createdBefore: daysAgo(7),
      noActivitySince: daysAgo(7),
    });

    expect(deleted).toBe(1);
    const remaining = (await prisma.user.findMany({ select: { id: true } })).map((row) => row.id);
    expect(remaining.sort()).toEqual([recentLogin, activeSinceLogin, young, verified].sort());
    // Cascata: nada da conta removida sobra, e o e-mail fica livre para o titular real.
    expect(await prisma.session.count({ where: { userId: abandoned } })).toBe(0);
    expect(await prisma.userToken.count({ where: { userId: abandoned } })).toBe(0);
  });

  it('works through every batch when more rows expired than fit in one', async () => {
    for (let index = 0; index < 5; index += 1) {
      await user({ createdDaysAgo: 10, verified: false });
    }
    const keeper = await user({ createdDaysAgo: 1, verified: false });

    const deleted = await new PrismaIdentityDataRetention(transactions, 2).deleteUnverifiedUsers({
      createdBefore: daysAgo(7),
      noActivitySince: daysAgo(7),
    });

    expect(deleted).toBe(5);
    expect((await prisma.user.findMany({ select: { id: true } })).map((row) => row.id)).toEqual([
      keeper,
    ]);
  });
});
