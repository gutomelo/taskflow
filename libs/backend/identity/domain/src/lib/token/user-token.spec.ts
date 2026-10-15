import {
  InvalidOrExpiredTokenError,
  USER_TOKEN_TTL_MS,
  UserToken,
  type UserTokenPurpose,
} from './user-token';

const T0 = new Date('2026-10-08T12:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

function issue(purpose: UserTokenPurpose): UserToken {
  return UserToken.issue({
    id: 'token-1',
    userId: 'user-1',
    purpose,
    tokenHash: 'hash-1',
    sourceEventId: 'event-1',
    now: T0,
  });
}

describe('UserToken', () => {
  it('expires email verification links after 24 h and password reset links after 30 min', () => {
    expect(issue('email_verification').toSnapshot().expiresAt).toEqual(at(24 * 60 * 60 * 1000));
    expect(issue('password_reset').toSnapshot().expiresAt).toEqual(at(30 * 60 * 1000));
  });

  it('is consumed exactly once', () => {
    const userToken = issue('email_verification');

    userToken.consume('email_verification', at(1_000));

    expect(userToken.toSnapshot().consumedAt).toEqual(at(1_000));
    expect(() => userToken.consume('email_verification', at(2_000))).toThrow(
      InvalidOrExpiredTokenError,
    );
  });

  it('cannot be consumed at or after expiration', () => {
    const ttl = USER_TOKEN_TTL_MS.password_reset;

    expect(() => issue('password_reset').consume('password_reset', at(ttl - 1))).not.toThrow();
    expect(() => issue('password_reset').consume('password_reset', at(ttl))).toThrow(
      InvalidOrExpiredTokenError,
    );
  });

  it('cannot be used for another purpose (a verification link never resets a password)', () => {
    expect(() => issue('email_verification').consume('password_reset', at(1_000))).toThrow(
      InvalidOrExpiredTokenError,
    );
  });

  it('uses the same error for every failure so callers cannot tell why it failed', () => {
    const failures = [
      () => issue('password_reset').consume('email_verification', at(1)),
      () => issue('password_reset').consume('password_reset', at(USER_TOKEN_TTL_MS.password_reset)),
    ];

    for (const failure of failures) {
      expect(failure).toThrow(expect.objectContaining({ code: 'INVALID_OR_EXPIRED_TOKEN' }));
    }
  });

  it('restores persisted state and exposes owner and purpose', () => {
    const snapshot = issue('password_reset').toSnapshot();
    const restored = UserToken.restore(snapshot);

    expect(restored.toSnapshot()).toEqual(snapshot);
    expect(restored.userId).toBe('user-1');
    expect(restored.purpose).toBe('password_reset');
  });
});
