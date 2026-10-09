import {
  createPrismaClient,
  PrismaTransactionRunner,
  TransactionRequiredError,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import type { RotationOutcome, SessionClient } from '@taskflow/backend/identity/domain';
import { browser, buildSession, buildUser, newToken } from '../../testing/identity-test-fixtures';
import { PrismaSessionRepository } from './prisma-session.repository';
import { PrismaUserRepository } from './prisma-user.repository';

describe('PrismaSessionRepository (integration)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let sessions: PrismaSessionRepository;
  let users: PrismaUserRepository;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma);
    sessions = new PrismaSessionRepository(transactions);
    users = new PrismaUserRepository(transactions);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE users CASCADE`;
  });

  async function persistedSession(now = new Date()) {
    const user = buildUser();
    await users.add(user);
    const session = buildSession(user.id, now);
    await sessions.add(session);
    return session;
  }

  /** Fluxo do caso de uso de refresh: lock → rotate → save, numa transação. */
  function refresh(presentedTokenHash: string, client: SessionClient = browser) {
    return transactions.run(async () => {
      const session = await sessions.findByRefreshTokenHashForUpdate(presentedTokenHash);
      if (!session) return { kind: 'not_found' } as const;
      const outcome = session.rotate({
        presentedTokenHash,
        newToken: newToken(),
        client,
        now: new Date(),
      });
      await sessions.save(session);
      return outcome;
    });
  }

  it('round-trips a new session with its current token', async () => {
    const session = await persistedSession();

    expect((await sessions.findById(session.id))?.toSnapshot()).toEqual(session.toSnapshot());
  });

  it('requires a transaction to lock a session by refresh token', async () => {
    const session = await persistedSession();

    await expect(
      sessions.findByRefreshTokenHashForUpdate(session.toSnapshot().currentToken.tokenHash),
    ).rejects.toBeInstanceOf(TransactionRequiredError);
  });

  it('returns null for an unknown refresh token', async () => {
    await persistedSession();

    expect(
      await transactions.run(() => sessions.findByRefreshTokenHashForUpdate('f'.repeat(64))),
    ).toBeNull();
  });

  it('BR-012: persists a rotation — new token becomes current, old one its predecessor', async () => {
    const session = await persistedSession();
    const originalHash = session.toSnapshot().currentToken.tokenHash;

    expect(await refresh(originalHash)).toEqual({ kind: 'rotated' });

    const reloaded = (await sessions.findById(session.id))?.toSnapshot();
    expect(reloaded?.previousToken).toMatchObject({
      tokenHash: originalHash,
      rotatedAt: expect.any(Date),
    });
    expect(reloaded?.currentToken.tokenHash).not.toBe(originalHash);
    expect(reloaded?.currentToken.rotatedAt).toBeNull();
  });

  it('BR-012: locks the session so a concurrent refresh waits and then sees the rotated state', async () => {
    const session = await persistedSession();
    const presented = session.toSnapshot().currentToken.tokenHash;
    let releaseFirst: () => void = () => undefined;
    const firstHoldsLock = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let lockAcquired: () => void = () => undefined;
    const lockAcquiredSignal = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });

    // A: adquire o lock, rotaciona e espera antes de confirmar.
    const first = transactions.run(async () => {
      const locked = await sessions.findByRefreshTokenHashForUpdate(presented);
      lockAcquired();
      const outcome = locked?.rotate({
        presentedTokenHash: presented,
        newToken: newToken(),
        client: browser,
        now: new Date(),
      });
      if (locked) await sessions.save(locked);
      await firstHoldsLock;
      return outcome;
    });
    await lockAcquiredSignal;

    // B: mesma renovação, iniciada enquanto A segura o lock.
    let secondFinished = false;
    const second = refresh(presented).finally(() => {
      secondFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(secondFinished).toBe(false);

    releaseFirst();
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(firstOutcome).toEqual({ kind: 'rotated' });
    expect(secondOutcome).toEqual({ kind: 'grace' });
    expect(
      await prisma.refreshToken.count({ where: { sessionId: session.id, rotatedAt: null } }),
    ).toBe(1);
  });

  it('BR-012: concurrent refreshes of the same token never yield two rotations', async () => {
    const session = await persistedSession();
    const presented = session.toSnapshot().currentToken.tokenHash;

    const outcomes = await Promise.all([refresh(presented), refresh(presented)]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['grace', 'rotated']);
    expect(
      await prisma.refreshToken.count({ where: { sessionId: session.id, rotatedAt: null } }),
    ).toBe(1);
  });

  it('BR-012: replaying the rotated token from another client revokes the session', async () => {
    const session = await persistedSession();
    const presented = session.toSnapshot().currentToken.tokenHash;
    const attacker: SessionClient = { ipPrefix: '198.51.100.0/24', userAgent: 'curl/8.5' };

    const outcomes: Array<RotationOutcome | { kind: 'not_found' }> = [];
    outcomes.push(await refresh(presented));
    outcomes.push(await refresh(presented, attacker));

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['rotated', 'reuse_detected']);
    expect((await sessions.findById(session.id))?.toSnapshot()).toMatchObject({
      revocationReason: 'reuse_detected',
      revokedAt: expect.any(Date),
    });
  });

  it('BR-012: the database itself refuses a second current token for a session', async () => {
    const session = await persistedSession();

    await expect(
      prisma.refreshToken.create({
        data: { ...newToken(), sessionId: session.id, createdAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it('lists only active sessions of the user, most recently used first', async () => {
    const user = buildUser();
    await users.add(user);
    const now = new Date();
    const older = buildSession(user.id, new Date(now.getTime() - 60_000));
    const newer = buildSession(user.id, now);
    const revoked = buildSession(user.id, now);
    revoked.revoke('logout', now);
    const expired = buildSession(user.id, new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000));
    for (const session of [older, newer, revoked, expired]) await sessions.add(session);
    const otherUserSession = await persistedSession();

    const active = await sessions.listActiveByUser(user.id, now);

    expect(active.map((session) => session.id)).toEqual([newer.id, older.id]);
    expect(active.map((session) => session.id)).not.toContain(otherUserSession.id);
  });

  it('BR-016: revokes all sessions of a user except the given one and returns their ids', async () => {
    const user = buildUser();
    await users.add(user);
    const [current, other1, other2] = [
      buildSession(user.id),
      buildSession(user.id),
      buildSession(user.id),
    ];
    for (const session of [current, other1, other2]) await sessions.add(session);
    const foreign = await persistedSession();

    const revokedIds = await sessions.revokeAllForUser(user.id, 'password_changed', new Date(), {
      exceptSessionId: current.id,
    });

    expect([...revokedIds].sort()).toEqual([other1.id, other2.id].sort());
    expect((await sessions.findById(current.id))?.isRevoked).toBe(false);
    expect((await sessions.findById(foreign.id))?.isRevoked).toBe(false);
    expect((await sessions.findById(other1.id))?.toSnapshot().revocationReason).toBe(
      'password_changed',
    );
  });

  it('cascades session and token removal when the user is deleted', async () => {
    const session = await persistedSession();

    await prisma.user.delete({ where: { id: session.userId } });

    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('rejects inconsistent session state at the database level', async () => {
    const session = await persistedSession();

    await expect(
      prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } }),
    ).rejects.toThrow();
    await expect(
      prisma.session.update({
        where: { id: session.id },
        data: { idleExpiresAt: new Date('2099-01-01T00:00:00.000Z') },
      }),
    ).rejects.toThrow();
  });
});
