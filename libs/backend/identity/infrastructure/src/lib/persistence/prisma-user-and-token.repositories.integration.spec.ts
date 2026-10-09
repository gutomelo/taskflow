import { randomUUID } from 'node:crypto';
import { EmailAddress, VersionConflictError } from '@taskflow/backend/shared/kernel';
import {
  EmailAlreadyRegisteredError,
  UserToken,
  type UserTokenPurpose,
} from '@taskflow/backend/identity/domain';
import {
  createPrismaClient,
  PrismaTransactionRunner,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import { buildUser, tokenHash } from '../../testing/identity-test-fixtures';
import { PrismaUserRepository } from './prisma-user.repository';
import { PrismaUserTokenRepository } from './prisma-user-token.repository';

describe('Identity repositories (integration)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let users: PrismaUserRepository;
  let tokens: PrismaUserTokenRepository;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    const transactions = new PrismaTransactionRunner(prisma);
    users = new PrismaUserRepository(transactions);
    tokens = new PrismaUserTokenRepository(transactions);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE users CASCADE`;
  });

  describe('PrismaUserRepository', () => {
    it('round-trips a user by id and by normalized email', async () => {
      const user = buildUser('ana@exemplo.com');
      await users.add(user);

      expect((await users.findById(user.id))?.toSnapshot()).toEqual(user.toSnapshot());
      expect((await users.findByEmail(EmailAddress.create(' ANA@Exemplo.com ')))?.id).toBe(user.id);
      expect(await users.findByEmail(EmailAddress.create('outra@exemplo.com'))).toBeNull();
    });

    it('finds several users by id, ignoring unknown ids (UserDirectory, spec 002)', async () => {
      const ana = buildUser('ana@exemplo.com');
      const bruno = buildUser('bruno@exemplo.com');
      await users.add(ana);
      await users.add(bruno);
      await users.add(buildUser('fora@exemplo.com'));

      const found = await users.findByIds([ana.id, randomUUID(), bruno.id]);

      expect(found.map((user) => user.id).sort()).toEqual([ana.id, bruno.id].sort());
      expect(await users.findByIds([])).toEqual([]);
    });

    it('BR-014: translates a duplicate email into EmailAlreadyRegisteredError', async () => {
      await users.add(buildUser('ana@exemplo.com'));

      await expect(users.add(buildUser('ana@exemplo.com'))).rejects.toBeInstanceOf(
        EmailAlreadyRegisteredError,
      );
    });

    it('BR-014: lets exactly one of two concurrent registrations with the same email win', async () => {
      const results = await Promise.allSettled([
        users.add(buildUser('corrida@exemplo.com')),
        users.add(buildUser('corrida@exemplo.com')),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
        EmailAlreadyRegisteredError,
      );
      expect(await prisma.user.count()).toBe(1);
    });

    it('BR-008: increments the version on save and rejects a stale copy', async () => {
      const user = buildUser();
      await users.add(user);
      const copyA = await users.findById(user.id);
      const copyB = await users.findById(user.id);
      if (!copyA || !copyB) throw new Error('user not found');

      copyA.verifyEmail(new Date());
      await users.save(copyA);
      copyB.changePassword('$argon2id$other', new Date());

      await expect(users.save(copyB)).rejects.toBeInstanceOf(VersionConflictError);
      const stored = await users.findById(user.id);
      expect(stored?.toSnapshot()).toMatchObject({ version: 2, emailVerifiedAt: expect.any(Date) });
      expect(stored?.passwordHash).toBe(user.passwordHash);
    });

    it('rejects non-normalized emails written behind the domain layer', async () => {
      await expect(
        prisma.user.create({
          data: {
            ...buildUser().toSnapshot(),
            email: 'Ana@Exemplo.com',
            name: 'Ana',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('PrismaUserTokenRepository', () => {
    async function userId(): Promise<string> {
      const user = buildUser();
      await users.add(user);
      return user.id;
    }

    function issue(
      owner: string,
      purpose: UserTokenPurpose,
      options: { now?: Date; eventId?: string; hash?: string } = {},
    ) {
      return UserToken.issue({
        id: randomUUID(),
        userId: owner,
        purpose,
        tokenHash: options.hash ?? tokenHash(),
        sourceEventId: options.eventId ?? randomUUID(),
        now: options.now ?? new Date(),
      });
    }

    it('consumes a token exactly once and returns its owner', async () => {
      const owner = await userId();
      const token = issue(owner, 'email_verification');
      await tokens.upsertForEvent(token);
      const hash = token.toSnapshot().tokenHash;

      expect(await tokens.consume(hash, 'email_verification', new Date())).toEqual({
        userId: owner,
      });
      expect(await tokens.consume(hash, 'email_verification', new Date())).toBeNull();
    });

    it('lets exactly one of many concurrent consumptions succeed', async () => {
      const owner = await userId();
      const token = issue(owner, 'password_reset');
      await tokens.upsertForEvent(token);
      const hash = token.toSnapshot().tokenHash;

      const results = await Promise.all(
        Array.from({ length: 5 }, () => tokens.consume(hash, 'password_reset', new Date())),
      );

      expect(results.filter((result) => result !== null)).toEqual([{ userId: owner }]);
    });

    it('refuses expired tokens and tokens of another purpose, indistinguishably', async () => {
      const owner = await userId();
      const issuedAt = new Date(Date.now() - 31 * 60 * 1000);
      const expired = issue(owner, 'password_reset', { now: issuedAt });
      const verification = issue(owner, 'email_verification');
      await tokens.upsertForEvent(expired);
      await tokens.upsertForEvent(verification);

      expect(
        await tokens.consume(expired.toSnapshot().tokenHash, 'password_reset', new Date()),
      ).toBeNull();
      expect(
        await tokens.consume(verification.toSnapshot().tokenHash, 'password_reset', new Date()),
      ).toBeNull();
      expect(await tokens.consume(tokenHash('unknown'), 'password_reset', new Date())).toBeNull();
    });

    it('replaces the token of an event on retry: only the latest link works (ADR 0011)', async () => {
      const owner = await userId();
      const eventId = randomUUID();
      const firstAttempt = issue(owner, 'email_verification', { eventId });
      const retry = issue(owner, 'email_verification', { eventId });
      expect(await tokens.upsertForEvent(firstAttempt)).toBe('issued');
      expect(await tokens.upsertForEvent(retry)).toBe('issued');

      expect(await prisma.userToken.count({ where: { sourceEventId: eventId } })).toBe(1);
      expect(
        await tokens.consume(firstAttempt.toSnapshot().tokenHash, 'email_verification', new Date()),
      ).toBeNull();
      expect(
        await tokens.consume(retry.toSnapshot().tokenHash, 'email_verification', new Date()),
      ).toEqual({ userId: owner });
    });

    it('never reactivates a consumed token when the same event is redelivered', async () => {
      const owner = await userId();
      const eventId = randomUUID();
      const delivered = issue(owner, 'password_reset', { eventId });
      await tokens.upsertForEvent(delivered);
      await tokens.consume(delivered.toSnapshot().tokenHash, 'password_reset', new Date());

      const redelivered = issue(owner, 'password_reset', { eventId });
      expect(await tokens.upsertForEvent(redelivered)).toBe('already_consumed');

      expect(
        await tokens.consume(redelivered.toSnapshot().tokenHash, 'password_reset', new Date()),
      ).toBeNull();
    });

    it('BR-017: finds the owner of a usable token without consuming it', async () => {
      const owner = await userId();
      const token = issue(owner, 'email_verification');
      await tokens.upsertForEvent(token);
      const hash = token.toSnapshot().tokenHash;

      expect(await tokens.findOwner(hash, 'email_verification', new Date())).toEqual({
        userId: owner,
      });
      expect(await tokens.findOwner(hash, 'password_reset', new Date())).toBeNull();
      expect(await tokens.consume(hash, 'email_verification', new Date())).toEqual({
        userId: owner,
      });
      expect(await tokens.findOwner(hash, 'email_verification', new Date())).toBeNull();
    });

    it('BR-017: consumes only when the token belongs to the expected user', async () => {
      const owner = await userId();
      const otherUser = await userId();
      const token = issue(owner, 'email_verification');
      await tokens.upsertForEvent(token);
      const hash = token.toSnapshot().tokenHash;

      expect(
        await tokens.consume(hash, 'email_verification', new Date(), { userId: otherUser }),
      ).toBeNull();
      expect(
        await tokens.consume(hash, 'email_verification', new Date(), { userId: owner }),
      ).toEqual({
        userId: owner,
      });
    });

    it('BR-016: invalidates pending tokens of a purpose, leaving others intact', async () => {
      const owner = await userId();
      const resets = [issue(owner, 'password_reset'), issue(owner, 'password_reset')];
      const verification = issue(owner, 'email_verification');
      for (const token of [...resets, verification]) await tokens.upsertForEvent(token);

      expect(await tokens.invalidatePending(owner, 'password_reset', new Date())).toBe(2);
      for (const reset of resets) {
        expect(
          await tokens.consume(reset.toSnapshot().tokenHash, 'password_reset', new Date()),
        ).toBeNull();
      }
      expect(
        await tokens.consume(verification.toSnapshot().tokenHash, 'email_verification', new Date()),
      ).toEqual({ userId: owner });
    });

    it('rejects tokens that would be born expired at the database level', async () => {
      const owner = await userId();
      const snapshot = issue(owner, 'password_reset').toSnapshot();

      await expect(
        prisma.userToken.create({ data: { ...snapshot, expiresAt: snapshot.createdAt } }),
      ).rejects.toThrow();
    });
  });
});
