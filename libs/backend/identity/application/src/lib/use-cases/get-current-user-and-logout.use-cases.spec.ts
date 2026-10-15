import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { PersonName, Session, SessionRevokedError, User } from '@taskflow/backend/identity/domain';
import { createIdentityTestbed } from '../../testing/identity-fakes';
import { GetCurrentUserUseCase } from './get-current-user.use-case';
import { LogoutUseCase } from './logout.use-case';

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
  const refresh = bed.secretTokens.generate();
  const session = Session.start({
    id: bed.idGenerator.generate(),
    userId: user.id,
    token: { id: bed.idGenerator.generate(), tokenHash: refresh.tokenHash },
    client: { ipPrefix: null, userAgent: null },
    now: bed.clock.now(),
  });
  await bed.sessions.add(session);
  const context = { requestId: 'req-1', actor: { userId: user.id, sessionId: session.id } };
  return {
    bed,
    user,
    session,
    refreshToken: refresh.token,
    context,
    logout: new LogoutUseCase(bed),
  };
}

describe('GetCurrentUserUseCase', () => {
  it('RF-12: returns the public view of the authenticated user', async () => {
    const { bed, user, context } = await setup();

    expect(await new GetCurrentUserUseCase(bed).execute(context)).toEqual({
      id: user.id,
      name: 'Ana',
      email: 'ana@exemplo.com',
      emailVerified: false,
    });
  });

  it('treats a session whose user no longer exists as revoked', async () => {
    const { bed, user, context } = await setup();
    bed.users.rows.delete(user.id);

    await expect(new GetCurrentUserUseCase(bed).execute(context)).rejects.toBeInstanceOf(
      SessionRevokedError,
    );
  });
});

describe('LogoutUseCase', () => {
  it('RF-07: revokes the current session and adds it to the revocation list', async () => {
    const { bed, session, logout } = await setup();

    await logout.execute({ sessionId: session.id, refreshToken: null });

    expect(bed.sessions.rows.get(session.id)).toMatchObject({ revocationReason: 'logout' });
    expect(await bed.revocationList.isRevoked(session.id)).toBe(true);
  });

  it('RF-07: logs out with only the refresh token when the access token has expired', async () => {
    const { bed, session, refreshToken, logout } = await setup();

    await logout.execute({ sessionId: null, refreshToken });

    expect(bed.sessions.rows.get(session.id)?.revokedAt).not.toBeNull();
  });

  it('is idempotent: unknown or already revoked sessions end without error or new writes', async () => {
    const { bed, session, logout } = await setup();
    await logout.execute({ sessionId: session.id, refreshToken: null });
    bed.revocationList.revoked.clear();

    await expect(
      logout.execute({ sessionId: session.id, refreshToken: null }),
    ).resolves.toBeUndefined();
    await expect(
      logout.execute({ sessionId: null, refreshToken: 'unknown' }),
    ).resolves.toBeUndefined();
    await expect(logout.execute({ sessionId: null, refreshToken: null })).resolves.toBeUndefined();
    expect(bed.revocationList.revoked.size).toBe(0);
  });

  it('RNF-08: does not revoke the session if the revocation list cannot be written', async () => {
    const { bed, session, logout } = await setup();
    bed.revocationList.failNextRevoke = true;

    await expect(logout.execute({ sessionId: session.id, refreshToken: null })).rejects.toThrow(
      'redis unavailable',
    );

    expect(bed.sessions.rows.get(session.id)?.revokedAt).toBeNull();
  });
});
