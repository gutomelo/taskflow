import type { Clock } from '@taskflow/backend/shared/kernel';
import {
  createPrismaClient,
  PrismaTransactionRunner,
  UuidV7Generator,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import {
  RefreshInProgressError,
  Session,
  SessionRevokedError,
} from '@taskflow/backend/identity/domain';
import {
  LogoutUseCase,
  RefreshSessionUseCase,
  RevokeSessionUseCase,
  type SecurityEvent,
  type SessionRevocationList,
} from '@taskflow/backend/identity/application';
import { buildUser } from '../../testing/identity-test-fixtures';
import { CryptoSecretTokenGenerator } from '../security/crypto-secret-token-generator';
import { JoseAccessTokens } from '../security/jose-access-tokens';
import { PrismaSessionRepository } from './prisma-session.repository';
import { PrismaUserRepository } from './prisma-user.repository';

class MutableClock implements Clock {
  current = new Date();
  now() {
    return this.current;
  }
}

describe('RefreshSessionUseCase with PostgreSQL (integration, CA-05)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let sessions: PrismaSessionRepository;
  let users: PrismaUserRepository;
  let clock: MutableClock;
  let refresh: RefreshSessionUseCase;
  let transactions: PrismaTransactionRunner;
  const secretTokens = new CryptoSecretTokenGenerator();
  const revoked = new Set<string>();
  const securityEvents: SecurityEvent[] = [];
  const client = { ipAddress: '203.0.113.10', userAgent: 'Firefox/140' };

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma);
    sessions = new PrismaSessionRepository(transactions);
    users = new PrismaUserRepository(transactions);
    clock = new MutableClock();
    const revocationList: SessionRevocationList = {
      revoke: async (ids) => ids.forEach((id) => revoked.add(id)),
      isRevoked: async (id) => revoked.has(id),
    };
    refresh = new RefreshSessionUseCase({
      sessions,
      secretTokens,
      accessTokens: new JoseAccessTokens({ keys: { k1: 'k'.repeat(43) }, activeKid: 'k1', clock }),
      revocationList,
      securityEvents: { record: (event) => securityEvents.push(event) },
      transactions,
      idGenerator: new UuidV7Generator(),
      clock,
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE users CASCADE`;
    revoked.clear();
    securityEvents.length = 0;
    clock.current = new Date();
  });

  async function startSession(): Promise<{ sessionId: string; refreshToken: string }> {
    const user = buildUser();
    await users.add(user);
    const secret = secretTokens.generate();
    const session = Session.start({
      id: new UuidV7Generator().generate(),
      userId: user.id,
      token: { id: new UuidV7Generator().generate(), tokenHash: secret.tokenHash },
      client: { ipPrefix: '203.0.113.0/24', userAgent: 'Firefox/140' },
      now: clock.now(),
    });
    await sessions.add(session);
    return { sessionId: session.id, refreshToken: secret.token };
  }

  const currentTokens = (sessionId: string) =>
    prisma.refreshToken.count({ where: { sessionId, rotatedAt: null } });

  it('CA-05: two tabs refreshing at once — one rotates, the other gets REFRESH_IN_PROGRESS, nobody is logged out', async () => {
    const { sessionId, refreshToken } = await startSession();

    const results = await Promise.allSettled([
      refresh.execute({ refreshToken, client }),
      refresh.execute({ refreshToken, client }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.status === 'rejected' && rejected[0].reason).toBeInstanceOf(
      RefreshInProgressError,
    );
    expect((await sessions.findById(sessionId))?.isRevoked).toBe(false);
    expect(await currentTokens(sessionId)).toBe(1);
  });

  it('CA-05: the rotated token works for the next refresh and the access token is a valid JWT', async () => {
    const { refreshToken } = await startSession();

    const first = await refresh.execute({ refreshToken, client });
    const second = await refresh.execute({ refreshToken: first.refreshToken, client });

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken.split('.')).toHaveLength(3);
  });

  it('CA-05: replaying a rotated token after 5 s revokes the session in the database and blocks its access token', async () => {
    const { sessionId, refreshToken } = await startSession();
    const { refreshToken: legitimate } = await refresh.execute({ refreshToken, client });
    clock.current = new Date(clock.current.getTime() + 6_000);

    await expect(refresh.execute({ refreshToken, client })).rejects.toBeInstanceOf(
      SessionRevokedError,
    );

    expect((await sessions.findById(sessionId))?.toSnapshot().revocationReason).toBe(
      'reuse_detected',
    );
    expect(revoked.has(sessionId)).toBe(true);
    expect(securityEvents.map((event) => event.type)).toEqual(['auth.refresh_reuse_detected']);
    await expect(refresh.execute({ refreshToken: legitimate, client })).rejects.toBeInstanceOf(
      SessionRevokedError,
    );
  });

  it('BR-012 (documented consequence): a third simultaneous refresh counts as reuse — the frontend must serialize refreshes across tabs (Web Locks, T24)', async () => {
    const { sessionId, refreshToken } = await startSession();

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => refresh.execute({ refreshToken, client })),
    );

    const reasons = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => (result.reason as Error).name)
      .sort();
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(reasons).toEqual(['RefreshInProgressError', 'SessionRevokedError']);
    expect((await sessions.findById(sessionId))?.isRevoked).toBe(true);
  });

  /**
   * Lista de revogação que segura o chamador até `release()`: pausa logout/revogação depois de
   * lerem a sessão e antes de gravarem, abrindo espaço para um refresh concorrente (T29/I1).
   */
  function gatedRevocationList() {
    let release: () => void = () => undefined;
    let paused: () => void = () => undefined;
    const isPaused = new Promise<void>((resolve) => (paused = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const list: SessionRevocationList = {
      revoke: async (ids) => {
        ids.forEach((id) => revoked.add(id));
        paused();
        await gate;
      },
      isRevoked: async (id) => revoked.has(id),
    };
    return { list, isPaused, release };
  }

  it.each([
    [
      'logout',
      (list: SessionRevocationList, sessionId: string) =>
        new LogoutUseCase({
          sessions,
          revocationList: list,
          secretTokens,
          transactions,
          clock,
        }).execute({
          sessionId,
          refreshToken: null,
        }),
    ],
    [
      'revoking it from the session list',
      async (list: SessionRevocationList, sessionId: string) => {
        const owner = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
        await new RevokeSessionUseCase({
          sessions,
          revocationList: list,
          securityEvents: { record: () => undefined },
          transactions,
          clock,
        }).execute(
          { requestId: 'r', actor: { userId: owner.userId, sessionId: 'other' } },
          sessionId,
        );
      },
    ],
  ])(
    'T29/I1: %s racing a refresh ends the session (no stale write, no 500)',
    async (_case, end) => {
      const { sessionId, refreshToken } = await startSession();
      const gated = gatedRevocationList();

      const ending = end(gated.list, sessionId);
      await gated.isPaused; // leu a sessão e está prestes a gravar
      const refreshing = refresh.execute({ refreshToken, client });
      // Dá ao refresh a chance de concluir antes da gravação (é o que acontecia sem o lock).
      await new Promise((resolve) => setTimeout(resolve, 300));
      gated.release();

      await expect(ending).resolves.toBeUndefined();
      await expect(refreshing).rejects.toBeInstanceOf(SessionRevokedError);
      expect((await sessions.findById(sessionId))?.isRevoked).toBe(true);
    },
  );
});
