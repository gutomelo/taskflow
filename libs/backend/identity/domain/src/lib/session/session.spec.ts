import {
  REFRESH_GRACE_PERIOD_MS,
  Session,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  type SessionClient,
} from './session';

const T0 = new Date('2026-10-08T12:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;

const browser: SessionClient = { ipPrefix: '203.0.113.0/24', userAgent: 'Firefox/140' };

let tokenSequence = 0;
const token = () => {
  tokenSequence += 1;
  return { id: `token-${tokenSequence}`, tokenHash: `hash-${tokenSequence}` };
};

function startSession(): Session {
  return Session.start({
    id: 'session-1',
    userId: 'user-1',
    token: token(),
    client: browser,
    now: T0,
  });
}

/** Renova com o token atual e devolve o hash que acabou de ser rotacionado. */
function rotateCurrent(session: Session, now: Date, client = browser): string {
  const rotatedHash = session.toSnapshot().currentToken.tokenHash;
  expect(
    session.rotate({ presentedTokenHash: rotatedHash, newToken: token(), client, now }),
  ).toEqual({
    kind: 'rotated',
  });
  return rotatedHash;
}

describe('Session', () => {
  describe('rotation (BR-012)', () => {
    it('BR-012: rotates the current token, keeping the old one as the immediate predecessor', () => {
      const session = startSession();
      const firstHash = session.toSnapshot().currentToken.tokenHash;

      rotateCurrent(session, at(1_000));

      const snapshot = session.toSnapshot();
      expect(snapshot.currentToken.tokenHash).not.toBe(firstHash);
      expect(snapshot.previousToken).toMatchObject({ tokenHash: firstHash, rotatedAt: at(1_000) });
      expect(snapshot.lastUsedAt).toEqual(at(1_000));
    });

    it('BR-012: tolerates the predecessor once, within 5 s, from the same client', () => {
      const session = startSession();
      const predecessor = rotateCurrent(session, at(1_000));
      const currentBefore = session.toSnapshot().currentToken;

      const outcome = session.rotate({
        presentedTokenHash: predecessor,
        newToken: token(),
        client: browser,
        now: at(1_000 + REFRESH_GRACE_PERIOD_MS),
      });

      expect(outcome).toEqual({ kind: 'grace' });
      expect(session.isActive(at(1_000 + REFRESH_GRACE_PERIOD_MS))).toBe(true);
      expect(session.toSnapshot().currentToken).toEqual(currentBefore);
    });

    it('BR-012: treats a second presentation of the predecessor as reuse and revokes', () => {
      const session = startSession();
      const predecessor = rotateCurrent(session, at(1_000));
      session.rotate({
        presentedTokenHash: predecessor,
        newToken: token(),
        client: browser,
        now: at(2_000),
      });

      const outcome = session.rotate({
        presentedTokenHash: predecessor,
        newToken: token(),
        client: browser,
        now: at(3_000),
      });

      expect(outcome).toEqual({ kind: 'reuse_detected' });
      expect(session.toSnapshot()).toMatchObject({
        revocationReason: 'reuse_detected',
        revokedAt: at(3_000),
      });
    });

    it('BR-012: revokes when the predecessor arrives after the 5 s window', () => {
      const session = startSession();
      const predecessor = rotateCurrent(session, at(1_000));

      const outcome = session.rotate({
        presentedTokenHash: predecessor,
        newToken: token(),
        client: browser,
        now: at(1_000 + REFRESH_GRACE_PERIOD_MS + 1),
      });

      expect(outcome).toEqual({ kind: 'reuse_detected' });
      expect(session.isRevoked).toBe(true);
    });

    it.each<[string, SessionClient]>([
      ['another IP prefix', { ...browser, ipPrefix: '198.51.100.0/24' }],
      ['another user agent', { ...browser, userAgent: 'curl/8.5' }],
    ])(
      'BR-012: revokes when the predecessor comes from %s, even inside the window',
      (_case, client) => {
        const session = startSession();
        const predecessor = rotateCurrent(session, at(1_000));

        expect(
          session.rotate({
            presentedTokenHash: predecessor,
            newToken: token(),
            client,
            now: at(1_500),
          }),
        ).toEqual({ kind: 'reuse_detected' });
      },
    );

    it('BR-012: revokes when an older token (not the immediate predecessor) is replayed', () => {
      const session = startSession();
      const oldest = rotateCurrent(session, at(1_000));
      rotateCurrent(session, at(2_000));

      expect(
        session.rotate({
          presentedTokenHash: oldest,
          newToken: token(),
          client: browser,
          now: at(2_100),
        }),
      ).toEqual({ kind: 'reuse_detected' });
    });

    it('BR-012: after reuse is detected, even the legitimate current token stops working', () => {
      const session = startSession();
      const predecessor = rotateCurrent(session, at(1_000));
      const current = session.toSnapshot().currentToken.tokenHash;
      session.rotate({
        presentedTokenHash: predecessor,
        newToken: token(),
        client: browser,
        now: at(60_000),
      });

      expect(
        session.rotate({
          presentedTokenHash: current,
          newToken: token(),
          client: browser,
          now: at(61_000),
        }),
      ).toEqual({ kind: 'revoked' });
    });
  });

  describe('expiration (BR-015)', () => {
    it('BR-015: starts with 7-day idle and 30-day absolute expiration', () => {
      const snapshot = startSession().toSnapshot();

      expect(snapshot.idleExpiresAt).toEqual(at(SESSION_IDLE_TIMEOUT_MS));
      expect(snapshot.absoluteExpiresAt).toEqual(at(SESSION_ABSOLUTE_TIMEOUT_MS));
    });

    it('BR-015: expires after 7 days without use', () => {
      const session = startSession();
      const current = session.toSnapshot().currentToken.tokenHash;

      expect(session.isActive(at(7 * DAY - 1))).toBe(true);
      expect(
        session.rotate({
          presentedTokenHash: current,
          newToken: token(),
          client: browser,
          now: at(7 * DAY),
        }),
      ).toEqual({ kind: 'expired' });
      expect(session.isRevoked).toBe(false);
    });

    it('BR-015: each use slides the idle expiration by 7 days', () => {
      const session = startSession();

      rotateCurrent(session, at(6 * DAY));

      expect(session.toSnapshot().idleExpiresAt).toEqual(at(13 * DAY));
      expect(session.isActive(at(12 * DAY))).toBe(true);
    });

    it('BR-015: expires 30 days after login even with continuous use', () => {
      const session = startSession();
      for (let day = 5; day <= 29; day += 5) {
        rotateCurrent(session, at(day * DAY));
      }
      const current = session.toSnapshot().currentToken.tokenHash;

      expect(session.toSnapshot().idleExpiresAt).toEqual(at(SESSION_ABSOLUTE_TIMEOUT_MS));
      expect(
        session.rotate({
          presentedTokenHash: current,
          newToken: token(),
          client: browser,
          now: at(30 * DAY),
        }),
      ).toEqual({ kind: 'expired' });
    });
  });

  it('BR-015: enforces the absolute expiration even if a persisted idle expiration exceeds it', () => {
    const snapshot = startSession().toSnapshot();
    const inconsistent = Session.restore({ ...snapshot, idleExpiresAt: at(60 * DAY) });

    expect(inconsistent.isActive(at(30 * DAY - 1))).toBe(true);
    expect(inconsistent.isActive(at(30 * DAY))).toBe(false);
  });

  it('exposes its identity for repositories and use cases', () => {
    const session = startSession();

    expect(session.id).toBe('session-1');
    expect(session.userId).toBe('user-1');
  });

  describe('revocation', () => {
    it('is idempotent and keeps the first reason', () => {
      const session = startSession();

      session.revoke('logout', at(1_000));
      session.revoke('password_changed', at(2_000));

      expect(session.toSnapshot()).toMatchObject({
        revokedAt: at(1_000),
        revocationReason: 'logout',
      });
    });

    it('rejects any rotation once revoked', () => {
      const session = startSession();
      const current = session.toSnapshot().currentToken.tokenHash;
      session.revoke('user_revoked', at(1_000));

      expect(
        session.rotate({
          presentedTokenHash: current,
          newToken: token(),
          client: browser,
          now: at(2_000),
        }),
      ).toEqual({ kind: 'revoked' });
    });
  });

  it('restores persisted state unchanged', () => {
    const snapshot = startSession().toSnapshot();

    expect(Session.restore(snapshot).toSnapshot()).toEqual(snapshot);
  });
});
