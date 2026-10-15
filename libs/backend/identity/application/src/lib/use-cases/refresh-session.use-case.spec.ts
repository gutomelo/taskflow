import { EmailAddress } from '@taskflow/backend/shared/kernel';
import {
  PersonName,
  RefreshInProgressError,
  Session,
  SessionExpiredError,
  SessionRevokedError,
  User,
} from '@taskflow/backend/identity/domain';
import { createIdentityTestbed } from '../../testing/identity-fakes';
import { RefreshSessionUseCase } from './refresh-session.use-case';

const client = { ipAddress: '203.0.113.10', userAgent: 'Firefox/140' };
const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const bed = createIdentityTestbed();
  const user = User.register({
    id: bed.idGenerator.generate(),
    email: EmailAddress.create('ana@exemplo.com'),
    name: PersonName.create('Ana'),
    passwordHash: 'fake-hash:x',
    now: bed.clock.now(),
  });
  await bed.users.add(user);
  const initial = bed.secretTokens.generate();
  const session = Session.start({
    id: bed.idGenerator.generate(),
    userId: user.id,
    token: { id: bed.idGenerator.generate(), tokenHash: initial.tokenHash },
    client: { ipPrefix: '203.0.113.0/24', userAgent: 'Firefox/140' },
    now: bed.clock.now(),
  });
  await bed.sessions.add(session);
  return {
    bed,
    user,
    session,
    initialToken: initial.token,
    refresh: new RefreshSessionUseCase(bed),
  };
}

describe('RefreshSessionUseCase', () => {
  it('RF-06 / BR-012: rotates the refresh token and issues a new access token', async () => {
    const { bed, user, session, initialToken, refresh } = await setup();
    bed.clock.advance(60_000);

    const result = await refresh.execute({ refreshToken: initialToken, client });

    expect(result).toMatchObject({ userId: user.id, sessionId: session.id });
    expect(result.refreshToken).not.toBe(initialToken);
    const stored = bed.sessions.rows.get(session.id);
    expect(stored?.currentToken.tokenHash).toBe(bed.secretTokens.hash(result.refreshToken));
    expect(stored?.previousToken?.tokenHash).toBe(bed.secretTokens.hash(initialToken));
    expect(result.refreshTokenExpiresAt).toEqual(new Date(bed.clock.now().getTime() + 7 * DAY));
    expect(bed.accessTokens.issued).toEqual([{ userId: user.id, sessionId: session.id }]);
  });

  it('BR-012: answers REFRESH_IN_PROGRESS to a concurrent tab within 5 s, keeping the session', async () => {
    const { bed, session, initialToken, refresh } = await setup();
    await refresh.execute({ refreshToken: initialToken, client });
    bed.clock.advance(2_000);

    await expect(refresh.execute({ refreshToken: initialToken, client })).rejects.toBeInstanceOf(
      RefreshInProgressError,
    );

    expect(bed.sessions.rows.get(session.id)?.revokedAt).toBeNull();
    expect(bed.securityEvents.types()).toEqual(['auth.refresh_grace_hit']);
  });

  it('BR-012: commits the grace marker before answering, so it cannot be used twice', async () => {
    const { bed, session, initialToken, refresh } = await setup();
    await refresh.execute({ refreshToken: initialToken, client });
    await expect(refresh.execute({ refreshToken: initialToken, client })).rejects.toBeInstanceOf(
      RefreshInProgressError,
    );

    await expect(refresh.execute({ refreshToken: initialToken, client })).rejects.toBeInstanceOf(
      SessionRevokedError,
    );
    expect(bed.sessions.rows.get(session.id)?.revocationReason).toBe('reuse_detected');
  });

  it('BR-012: revokes the whole session on reuse, blocks its access token and records the event', async () => {
    const { bed, user, session, initialToken, refresh } = await setup();
    const { refreshToken: legitimate } = await refresh.execute({
      refreshToken: initialToken,
      client,
    });
    bed.clock.advance(60_000);

    await expect(refresh.execute({ refreshToken: initialToken, client })).rejects.toBeInstanceOf(
      SessionRevokedError,
    );

    expect(bed.sessions.rows.get(session.id)).toMatchObject({ revocationReason: 'reuse_detected' });
    expect(await bed.revocationList.isRevoked(session.id)).toBe(true);
    expect(bed.securityEvents.events).toEqual([
      { type: 'auth.refresh_reuse_detected', userId: user.id, sessionId: session.id },
    ]);
    await expect(refresh.execute({ refreshToken: legitimate, client })).rejects.toBeInstanceOf(
      SessionRevokedError,
    );
  });

  it('RNF-08: keeps the session unrevoked if the revocation list cannot be written on reuse', async () => {
    const { bed, session, initialToken, refresh } = await setup();
    await refresh.execute({ refreshToken: initialToken, client });
    bed.clock.advance(60_000);
    bed.revocationList.failNextRevoke = true;

    await expect(refresh.execute({ refreshToken: initialToken, client })).rejects.toThrow(
      'redis unavailable',
    );

    expect(bed.sessions.rows.get(session.id)?.revokedAt).toBeNull();
  });

  it('BR-015: rejects refresh after 7 days without use', async () => {
    const { bed, initialToken, refresh } = await setup();
    bed.clock.advance(7 * DAY);

    await expect(refresh.execute({ refreshToken: initialToken, client })).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
  });

  it.each([['an unknown token', async () => 'never-issued']])(
    'rejects %s as a revoked session',
    async (_case, token) => {
      const { refresh } = await setup();

      await expect(refresh.execute({ refreshToken: await token(), client })).rejects.toBeInstanceOf(
        SessionRevokedError,
      );
    },
  );

  it('rejects the refresh token of a logged-out session', async () => {
    const { bed, session, initialToken, refresh } = await setup();
    const loaded = await bed.sessions.findById(session.id);
    loaded?.revoke('logout', bed.clock.now());
    if (loaded) await bed.sessions.save(loaded);

    await expect(refresh.execute({ refreshToken: initialToken, client })).rejects.toBeInstanceOf(
      SessionRevokedError,
    );
    expect(bed.accessTokens.issued).toHaveLength(0);
  });
});
