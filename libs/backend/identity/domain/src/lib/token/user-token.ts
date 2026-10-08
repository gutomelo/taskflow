import { DomainError } from '@taskflow/backend/shared/kernel';

export type UserTokenPurpose = 'email_verification' | 'password_reset';

/** Validade por finalidade (spec 001, RF-02 e RF-10). */
export const USER_TOKEN_TTL_MS: Readonly<Record<UserTokenPurpose, number>> = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
};

/** Mesmo erro para inexistente, expirado, consumido ou de outra finalidade: sem oráculo. */
export class InvalidOrExpiredTokenError extends DomainError {
  readonly code = 'INVALID_OR_EXPIRED_TOKEN';
  constructor() {
    super('Token is invalid, expired or already used');
  }
}

export type UserTokenSnapshot = Readonly<{
  id: string;
  userId: string;
  purpose: UserTokenPurpose;
  tokenHash: string;
  /** Evento da outbox que originou o token: idempotência do envio (ADR 0011). */
  sourceEventId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}>;

export interface IssueUserTokenInput {
  readonly id: string;
  readonly userId: string;
  readonly purpose: UserTokenPurpose;
  readonly tokenHash: string;
  readonly sourceEventId: string;
  readonly now: Date;
}

/**
 * Token de uso único enviado por e-mail (verificação ou redefinição de senha).
 * Persistido apenas como hash. Em produção o consumo é atômico no banco
 * (`UPDATE … WHERE consumed_at IS NULL AND expires_at > now()`); estas regras definem a semântica.
 */
export class UserToken {
  private constructor(private state: UserTokenSnapshot) {}

  static issue({
    id,
    userId,
    purpose,
    tokenHash,
    sourceEventId,
    now,
  }: IssueUserTokenInput): UserToken {
    return new UserToken({
      id,
      userId,
      purpose,
      tokenHash,
      sourceEventId,
      expiresAt: new Date(now.getTime() + USER_TOKEN_TTL_MS[purpose]),
      consumedAt: null,
      createdAt: now,
    });
  }

  static restore(snapshot: UserTokenSnapshot): UserToken {
    return new UserToken(snapshot);
  }

  get userId(): string {
    return this.state.userId;
  }

  get purpose(): UserTokenPurpose {
    return this.state.purpose;
  }

  /** Consome para a finalidade esperada; qualquer falha resulta no mesmo erro. */
  consume(expectedPurpose: UserTokenPurpose, now: Date): void {
    if (
      this.state.purpose !== expectedPurpose ||
      this.state.consumedAt !== null ||
      now.getTime() >= this.state.expiresAt.getTime()
    ) {
      throw new InvalidOrExpiredTokenError();
    }
    this.state = { ...this.state, consumedAt: now };
  }

  toSnapshot(): UserTokenSnapshot {
    return this.state;
  }
}
