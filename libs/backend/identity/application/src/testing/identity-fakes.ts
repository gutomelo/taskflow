import { createHash } from 'node:crypto';
import type {
  IntegrationEvent,
  OutboxWriter,
  Pseudonymizer,
  RateLimitDecision,
  RateLimitPolicy,
  RateLimiter,
  TransactionRunner,
} from '@taskflow/backend/shared/application';
import {
  VersionConflictError,
  type Clock,
  type EmailAddress,
  type IdGenerator,
} from '@taskflow/backend/shared/kernel';
import {
  EmailAlreadyRegisteredError,
  Session,
  User,
  UserToken,
  type GeneratedSecret,
  type Password,
  type PasswordHasher,
  type SecretTokenGenerator,
  type SessionRepository,
  type SessionRevocationReason,
  type SessionSnapshot,
  type UserRepository,
  type UserSnapshot,
  type UserTokenPurpose,
  type UserTokenRepository,
  type UserTokenSnapshot,
} from '@taskflow/backend/identity/domain';
import type {
  AccessTokenIssuer,
  AccessTokenSubject,
  AccessTokenVerifier,
  IssuedAccessToken,
} from '../lib/ports/access-tokens';
import type { SecurityEvent, SecurityEventRecorder } from '../lib/ports/security-event-recorder';
import type { SessionRevocationList } from '../lib/ports/session-revocation-list';

/** Participante de transação com estado copiável (simula o rollback do banco). */
interface TransactionalStore {
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

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.depth > 0) return work();
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

export class InMemoryUserRepository implements UserRepository, TransactionalStore {
  rows = new Map<string, UserSnapshot>();
  failNextSaveWithConflict = false;
  failNextAddWithDuplicate = false;

  snapshot() {
    return new Map(this.rows);
  }
  restore(state: unknown) {
    this.rows = state as Map<string, UserSnapshot>;
  }

  async findById(id: string) {
    const row = this.rows.get(id);
    return row ? User.restore(row) : null;
  }
  async findByEmail(email: EmailAddress) {
    const row = [...this.rows.values()].find((candidate) => candidate.email.value === email.value);
    return row ? User.restore(row) : null;
  }
  async add(user: User) {
    const snapshot = user.toSnapshot();
    if (this.failNextAddWithDuplicate || (await this.findByEmail(snapshot.email))) {
      this.failNextAddWithDuplicate = false;
      throw new EmailAlreadyRegisteredError();
    }
    this.rows.set(snapshot.id, snapshot);
  }
  async save(user: User) {
    const snapshot = user.toSnapshot();
    const stored = this.rows.get(snapshot.id);
    if (this.failNextSaveWithConflict || !stored || stored.version !== snapshot.version) {
      this.failNextSaveWithConflict = false;
      throw new VersionConflictError('User');
    }
    this.rows.set(snapshot.id, { ...snapshot, version: snapshot.version + 1 });
  }
}

export class InMemorySessionRepository implements SessionRepository, TransactionalStore {
  rows = new Map<string, SessionSnapshot>();
  /** Hashes de tokens antigos (além do atual e do predecessor) por sessão. */
  olderTokenHashes = new Map<string, string>();

  constructor(private readonly transactions: FakeTransactionRunner) {}

  snapshot() {
    return { rows: new Map(this.rows), older: new Map(this.olderTokenHashes) };
  }
  restore(state: unknown) {
    const saved = state as { rows: Map<string, SessionSnapshot>; older: Map<string, string> };
    this.rows = saved.rows;
    this.olderTokenHashes = saved.older;
  }

  async add(session: Session) {
    this.rows.set(session.id, session.toSnapshot());
  }
  async findByRefreshTokenHashForUpdate(tokenHash: string) {
    if (!this.transactions.inTransaction) {
      throw new Error('findByRefreshTokenHashForUpdate requires a transaction');
    }
    const owner =
      [...this.rows.values()].find(
        (row) =>
          row.currentToken.tokenHash === tokenHash || row.previousToken?.tokenHash === tokenHash,
      )?.id ?? this.olderTokenHashes.get(tokenHash);
    return owner ? this.findById(owner) : null;
  }
  async findById(sessionId: string) {
    const row = this.rows.get(sessionId);
    return row ? Session.restore(row) : null;
  }
  async listActiveByUser(userId: string, now: Date) {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .map((row) => Session.restore(row))
      .filter((session) => session.isActive(now))
      .sort((a, b) => b.toSnapshot().lastUsedAt.getTime() - a.toSnapshot().lastUsedAt.getTime());
  }
  async save(session: Session) {
    const before = this.rows.get(session.id);
    const after = session.toSnapshot();
    if (
      before?.previousToken &&
      before.previousToken.tokenHash !== after.previousToken?.tokenHash
    ) {
      this.olderTokenHashes.set(before.previousToken.tokenHash, session.id);
    }
    this.rows.set(session.id, after);
  }
  async revokeAllForUser(
    userId: string,
    reason: SessionRevocationReason,
    now: Date,
    options: { readonly exceptSessionId?: string } = {},
  ) {
    const revoked: string[] = [];
    for (const row of this.rows.values()) {
      if (row.userId !== userId || row.revokedAt || row.id === options.exceptSessionId) continue;
      this.rows.set(row.id, { ...row, revokedAt: now, revocationReason: reason });
      revoked.push(row.id);
    }
    return revoked;
  }
}

export class InMemoryUserTokenRepository implements UserTokenRepository, TransactionalStore {
  rows = new Map<string, UserTokenSnapshot>();

  snapshot() {
    return new Map(this.rows);
  }
  restore(state: unknown) {
    this.rows = state as Map<string, UserTokenSnapshot>;
  }

  async upsertForEvent(token: UserToken) {
    const snapshot = token.toSnapshot();
    const existing = [...this.rows.values()].find(
      (row) => row.sourceEventId === snapshot.sourceEventId,
    );
    if (existing) {
      this.rows.delete(existing.id);
      this.rows.set(existing.id, {
        ...existing,
        tokenHash: snapshot.tokenHash,
        expiresAt: snapshot.expiresAt,
      });
      return;
    }
    this.rows.set(snapshot.id, snapshot);
  }
  async consume(
    tokenHash: string,
    purpose: UserTokenPurpose,
    now: Date,
    options: { readonly userId?: string } = {},
  ) {
    const row = await this.usable(tokenHash, purpose, now);
    if (!row || (options.userId && row.userId !== options.userId)) return null;
    this.rows.set(row.id, { ...row, consumedAt: now });
    return { userId: row.userId };
  }
  async findOwner(tokenHash: string, purpose: UserTokenPurpose, now: Date) {
    const row = await this.usable(tokenHash, purpose, now);
    return row ? { userId: row.userId } : null;
  }
  private async usable(tokenHash: string, purpose: UserTokenPurpose, now: Date) {
    const row = [...this.rows.values()].find((candidate) => candidate.tokenHash === tokenHash);
    return row && row.purpose === purpose && !row.consumedAt && row.expiresAt > now ? row : null;
  }
  async invalidatePending(userId: string, purpose: UserTokenPurpose, now: Date) {
    let count = 0;
    for (const row of this.rows.values()) {
      if (
        row.userId === userId &&
        row.purpose === purpose &&
        !row.consumedAt &&
        row.expiresAt > now
      ) {
        this.rows.set(row.id, { ...row, consumedAt: now });
        count += 1;
      }
    }
    return count;
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

/** Hash reversível só para testes: permite asserções sobre o que foi "hasheado". */
export class FakePasswordHasher implements PasswordHasher {
  hashCalls = 0;
  verifyCalls: Array<{ passwordHash: string; candidate: string }> = [];
  outdatedHashes = new Set<string>();

  async hash(password: Password) {
    this.hashCalls += 1;
    return `fake-hash:${password.reveal()}`;
  }
  async verify(passwordHash: string, candidate: string) {
    this.verifyCalls.push({ passwordHash, candidate });
    return (
      passwordHash === `fake-hash:${candidate.normalize('NFC')}` ||
      passwordHash === `legacy:${candidate}`
    );
  }
  needsRehash(passwordHash: string) {
    return passwordHash.startsWith('legacy:') || this.outdatedHashes.has(passwordHash);
  }
}

export class FakeSecretTokens implements SecretTokenGenerator {
  private next = 0;
  generate(): GeneratedSecret {
    this.next += 1;
    const token = `secret-token-${this.next}`;
    return { token, tokenHash: this.hash(token) };
  }
  hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}

export class FakeAccessTokens implements AccessTokenIssuer, AccessTokenVerifier {
  issued: AccessTokenSubject[] = [];
  constructor(private readonly clock: Clock) {}
  async issue(subject: AccessTokenSubject): Promise<IssuedAccessToken> {
    this.issued.push(subject);
    return {
      token: `access(${subject.userId},${subject.sessionId})`,
      expiresAt: new Date(this.clock.now().getTime() + 15 * 60 * 1000),
    };
  }
  async verify(token: string) {
    const match = /^access\(([^,]+),([^)]+)\)$/.exec(token);
    return match?.[1] && match[2] ? { userId: match[1], sessionId: match[2] } : null;
  }
}

export class FakeRevocationList implements SessionRevocationList {
  revoked = new Set<string>();
  failNextRevoke = false;
  async revoke(sessionIds: ReadonlyArray<string>) {
    if (this.failNextRevoke) {
      this.failNextRevoke = false;
      throw new Error('redis unavailable');
    }
    sessionIds.forEach((id) => this.revoked.add(id));
  }
  async isRevoked(sessionId: string) {
    return this.revoked.has(sessionId);
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

export class RecordingSecurityEvents implements SecurityEventRecorder {
  events: SecurityEvent[] = [];
  record(event: SecurityEvent) {
    this.events.push(event);
  }
  types(): string[] {
    return this.events.map((event) => event.type);
  }
}

export const fakePseudonymizer: Pseudonymizer = {
  pseudonymize: (value) =>
    `pseudo(${value.length})#${[...value].reduce((sum, char) => sum + char.charCodeAt(0), 0)}`,
};

/** Grafo completo de fakes para os testes de casos de uso. */
export function createIdentityTestbed() {
  const transactions = new FakeTransactionRunner();
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository(transactions);
  const userTokens = new InMemoryUserTokenRepository();
  const outbox = new InMemoryOutbox(transactions);
  transactions.register(users, sessions, userTokens, outbox);
  const clock = new FixedClock();
  return {
    transactions,
    users,
    sessions,
    userTokens,
    outbox,
    clock,
    idGenerator: new SequentialIds(),
    passwordHasher: new FakePasswordHasher(),
    secretTokens: new FakeSecretTokens(),
    accessTokens: new FakeAccessTokens(clock),
    revocationList: new FakeRevocationList(),
    rateLimiter: new InMemoryRateLimiter(),
    securityEvents: new RecordingSecurityEvents(),
    pseudonymizer: fakePseudonymizer,
    commonPasswords: { contains: (password: string) => password.toLowerCase() === 'password1!' },
  };
}

export type IdentityTestbed = ReturnType<typeof createIdentityTestbed>;
