import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { PersonName, Session, User } from '@taskflow/backend/identity/domain';
import { createIdentityTestbed, type IdentityTestbed } from '../../testing/identity-fakes';
import { SessionNotFoundError } from '../shared/identity-errors';
import { ListSessionsUseCase } from './list-sessions.use-case';
import { RevokeSessionUseCase } from './revoke-session.use-case';

const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36';

async function addUser(bed: IdentityTestbed, email: string) {
  const user = User.register({
    id: bed.idGenerator.generate(),
    email: EmailAddress.create(email),
    name: PersonName.create('Pessoa'),
    passwordHash: 'fake-hash:x',
    now: bed.clock.now(),
  });
  await bed.users.add(user);
  return user;
}

async function addSession(bed: IdentityTestbed, userId: string, userAgent: string | null) {
  const session = Session.start({
    id: bed.idGenerator.generate(),
    userId,
    token: { id: bed.idGenerator.generate(), tokenHash: bed.secretTokens.generate().tokenHash },
    client: { ipPrefix: '203.0.113.0/24', userAgent },
    now: bed.clock.now(),
  });
  await bed.sessions.add(session);
  bed.clock.advance(1_000);
  return session;
}

async function setup() {
  const bed = createIdentityTestbed();
  const ana = await addUser(bed, 'ana@exemplo.com');
  const bia = await addUser(bed, 'bia@exemplo.com');
  const laptop = await addSession(bed, ana.id, FIREFOX_LINUX);
  const phone = await addSession(bed, ana.id, CHROME_ANDROID);
  const biaSession = await addSession(bed, bia.id, FIREFOX_LINUX);
  const context = { requestId: 'req-1', actor: { userId: ana.id, sessionId: laptop.id } };
  return { bed, ana, laptop, phone, biaSession, context };
}

describe('ListSessionsUseCase', () => {
  it('RF-08: lists the user active sessions with device summary and the current one flagged', async () => {
    const { bed, laptop, phone, context } = await setup();

    const sessions = await new ListSessionsUseCase(bed).execute(context);

    expect(sessions.map(({ id, device, isCurrent }) => ({ id, device, isCurrent }))).toEqual([
      { id: phone.id, device: { browser: 'Chrome', os: 'Android' }, isCurrent: false },
      { id: laptop.id, device: { browser: 'Firefox', os: 'Linux' }, isCurrent: true },
    ]);
  });

  it('never exposes network or token data', async () => {
    const { bed, context } = await setup();

    const serialized = JSON.stringify(await new ListSessionsUseCase(bed).execute(context));

    expect(serialized).not.toMatch(/203\.0\.113|tokenHash|ipPrefix/);
  });
});

describe('RevokeSessionUseCase', () => {
  it('RF-08: revokes another own session immediately and records the event', async () => {
    const { bed, ana, phone, context } = await setup();

    await new RevokeSessionUseCase(bed).execute(context, phone.id);

    expect(bed.sessions.rows.get(phone.id)).toMatchObject({ revocationReason: 'user_revoked' });
    expect(await bed.revocationList.isRevoked(phone.id)).toBe(true);
    expect(bed.securityEvents.events).toEqual([
      { type: 'auth.session_revoked', userId: ana.id, sessionId: phone.id, reason: 'user_revoked' },
    ]);
    expect((await new ListSessionsUseCase(bed).execute(context)).map(({ id }) => id)).not.toContain(
      phone.id,
    );
  });

  it('answers 404-equivalent for sessions of other users and unknown ids (no IDOR)', async () => {
    const { bed, biaSession, context } = await setup();
    const revoke = new RevokeSessionUseCase(bed);

    await expect(revoke.execute(context, biaSession.id)).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
    await expect(revoke.execute(context, 'unknown-session')).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
    expect(bed.sessions.rows.get(biaSession.id)?.revokedAt).toBeNull();
  });

  it('is idempotent for an already revoked session', async () => {
    const { bed, phone, context } = await setup();
    const revoke = new RevokeSessionUseCase(bed);
    await revoke.execute(context, phone.id);

    await expect(revoke.execute(context, phone.id)).resolves.toBeUndefined();
    expect(bed.securityEvents.events).toHaveLength(1);
  });

  it('RNF-08: keeps the session active if the revocation list cannot be written', async () => {
    const { bed, phone, context } = await setup();
    bed.revocationList.failNextRevoke = true;

    await expect(new RevokeSessionUseCase(bed).execute(context, phone.id)).rejects.toThrow(
      'redis unavailable',
    );
    expect(bed.sessions.rows.get(phone.id)?.revokedAt).toBeNull();
    expect(bed.securityEvents.events).toHaveLength(0);
  });
});
