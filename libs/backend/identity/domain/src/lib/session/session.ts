/** BR-015 */
export const SESSION_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
/** BR-012 */
export const REFRESH_GRACE_PERIOD_MS = 5_000;

export type SessionRevocationReason =
  'logout' | 'user_revoked' | 'reuse_detected' | 'password_changed' | 'password_reset';

/** Cliente aproximado (minimização de dados): prefixo de IP e user agent. */
export type SessionClient = Readonly<{
  ipPrefix: string | null;
  userAgent: string | null;
}>;

/** Refresh token persistido apenas como hash (SHA-256). */
export type RefreshTokenRecord = Readonly<{
  id: string;
  tokenHash: string;
  createdAt: Date;
  rotatedAt: Date | null;
  graceUsedAt: Date | null;
}>;

export type NewRefreshToken = Readonly<{ id: string; tokenHash: string }>;

export type SessionSnapshot = Readonly<{
  id: string;
  userId: string;
  createdAt: Date;
  lastUsedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revocationReason: SessionRevocationReason | null;
  client: SessionClient;
  /** Token válido para a próxima renovação. */
  currentToken: RefreshTokenRecord;
  /** Predecessor imediato do atual (único elegível à tolerância de BR-012). */
  previousToken: RefreshTokenRecord | null;
}>;

export type RotationOutcome =
  | Readonly<{ kind: 'rotated' }>
  | Readonly<{ kind: 'grace' }>
  | Readonly<{ kind: 'reuse_detected' }>
  | Readonly<{ kind: 'expired' }>
  | Readonly<{ kind: 'revoked' }>;

export interface RotateInput {
  readonly presentedTokenHash: string;
  readonly newToken: NewRefreshToken;
  readonly client: SessionClient;
  readonly now: Date;
}

export interface StartSessionInput {
  readonly id: string;
  readonly userId: string;
  readonly token: NewRefreshToken;
  readonly client: SessionClient;
  readonly now: Date;
}

const addMs = (date: Date, ms: number) => new Date(date.getTime() + ms);
const earliest = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

/**
 * Sessão de login (agregado). Concentra BR-012 (rotação com detecção de reuso e tolerância
 * estrita) e BR-015 (expiração deslizante de 7 dias, absoluta de 30 dias).
 * A concorrência entre renovações é serializada pelo repositório (lock da sessão).
 */
export class Session {
  private constructor(private state: SessionSnapshot) {}

  static start({ id, userId, token, client, now }: StartSessionInput): Session {
    const absoluteExpiresAt = addMs(now, SESSION_ABSOLUTE_TIMEOUT_MS);
    return new Session({
      id,
      userId,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: earliest(addMs(now, SESSION_IDLE_TIMEOUT_MS), absoluteExpiresAt),
      absoluteExpiresAt,
      revokedAt: null,
      revocationReason: null,
      client,
      currentToken: { ...token, createdAt: now, rotatedAt: null, graceUsedAt: null },
      previousToken: null,
    });
  }

  static restore(snapshot: SessionSnapshot): Session {
    return new Session(snapshot);
  }

  get id(): string {
    return this.state.id;
  }

  get userId(): string {
    return this.state.userId;
  }

  get isRevoked(): boolean {
    return this.state.revokedAt !== null;
  }

  isExpired(now: Date): boolean {
    return (
      now.getTime() >= this.state.idleExpiresAt.getTime() ||
      now.getTime() >= this.state.absoluteExpiresAt.getTime()
    );
  }

  isActive(now: Date): boolean {
    return !this.isRevoked && !this.isExpired(now);
  }

  rotate({ presentedTokenHash, newToken, client, now }: RotateInput): RotationOutcome {
    if (this.isRevoked) return { kind: 'revoked' };
    if (this.isExpired(now)) return { kind: 'expired' };

    const { currentToken, previousToken } = this.state;

    if (presentedTokenHash === currentToken.tokenHash) {
      this.state = {
        ...this.state,
        lastUsedAt: now,
        idleExpiresAt: earliest(addMs(now, SESSION_IDLE_TIMEOUT_MS), this.state.absoluteExpiresAt),
        client,
        previousToken: { ...currentToken, rotatedAt: now },
        currentToken: { ...newToken, createdAt: now, rotatedAt: null, graceUsedAt: null },
      };
      return { kind: 'rotated' };
    }

    if (previousToken && this.isWithinGrace(previousToken, presentedTokenHash, client, now)) {
      this.state = { ...this.state, previousToken: { ...previousToken, graceUsedAt: now } };
      return { kind: 'grace' };
    }

    // Token da sessão apresentado fora das condições: provável roubo (BR-012).
    this.revoke('reuse_detected', now);
    return { kind: 'reuse_detected' };
  }

  /** Idempotente: preserva o primeiro motivo e instante de revogação. */
  revoke(reason: SessionRevocationReason, now: Date): void {
    if (this.isRevoked) return;
    this.state = { ...this.state, revokedAt: now, revocationReason: reason };
  }

  toSnapshot(): SessionSnapshot {
    return this.state;
  }

  private isWithinGrace(
    previousToken: RefreshTokenRecord,
    presentedTokenHash: string,
    client: SessionClient,
    now: Date,
  ): boolean {
    return (
      presentedTokenHash === previousToken.tokenHash &&
      previousToken.rotatedAt !== null &&
      previousToken.graceUsedAt === null &&
      now.getTime() - previousToken.rotatedAt.getTime() <= REFRESH_GRACE_PERIOD_MS &&
      client.ipPrefix === this.state.client.ipPrefix &&
      client.userAgent === this.state.client.userAgent
    );
  }
}
