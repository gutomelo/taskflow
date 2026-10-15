import { EmailAddress, InvalidEmailAddressError } from '@taskflow/backend/shared/kernel';
import {
  InvalidOrExpiredTokenError,
  PasswordPolicyViolationError,
  PersonName,
  Session,
  User,
  UserToken,
  type UserTokenPurpose,
} from '@taskflow/backend/identity/domain';
import { createIdentityTestbed, type IdentityTestbed } from '../../testing/identity-fakes';
import { EmailDeliveryThrottle } from '../shared/email-delivery-throttle';
import { CurrentPasswordIncorrectError } from '../shared/identity-errors';
import { IdentityEventType } from '../shared/identity-events';
import { ChangePasswordUseCase } from './change-password.use-case';
import { RequestPasswordResetUseCase } from './request-password-reset.use-case';
import { ResetPasswordUseCase } from './reset-password.use-case';

const client = { ipAddress: '203.0.113.10', userAgent: 'Firefox/140' };
const CURRENT = 'Senha-Atual-1';
const NEXT = 'Nova-Senha-2026!';

async function seed() {
  const bed = createIdentityTestbed();
  const user = User.register({
    id: bed.idGenerator.generate(),
    email: EmailAddress.create('ana@exemplo.com'),
    name: PersonName.create('Ana'),
    passwordHash: `fake-hash:${CURRENT}`,
    now: bed.clock.now(),
  });
  await bed.users.add(user);
  const startSession = async () => {
    const session = Session.start({
      id: bed.idGenerator.generate(),
      userId: user.id,
      token: { id: bed.idGenerator.generate(), tokenHash: bed.secretTokens.generate().tokenHash },
      client: { ipPrefix: null, userAgent: null },
      now: bed.clock.now(),
    });
    await bed.sessions.add(session);
    return session;
  };
  const current = await startSession();
  const other = await startSession();
  return {
    bed,
    user,
    current,
    other,
    context: { requestId: 'req-1', actor: { userId: user.id, sessionId: current.id } },
  };
}

async function issueToken(
  bed: IdentityTestbed,
  userId: string,
  purpose: UserTokenPurpose = 'password_reset',
) {
  const secret = bed.secretTokens.generate();
  await bed.userTokens.upsertForEvent(
    UserToken.issue({
      id: bed.idGenerator.generate(),
      userId,
      purpose,
      tokenHash: secret.tokenHash,
      sourceEventId: bed.idGenerator.generate(),
      now: bed.clock.now(),
    }),
  );
  return secret.token;
}

const isUsable = (
  bed: IdentityTestbed,
  token: string,
  purpose: UserTokenPurpose = 'password_reset',
) => bed.userTokens.findOwner(bed.secretTokens.hash(token), purpose, bed.clock.now());

describe('ChangePasswordUseCase (RF-09, BR-016)', () => {
  it('BR-016: replaces the password, revokes every existing session and opens a new one for the requester', async () => {
    const { bed, user, current, other, context } = await seed();
    const pendingReset = await issueToken(bed, user.id);

    const result = await new ChangePasswordUseCase(bed).execute(context, {
      currentPassword: CURRENT,
      newPassword: NEXT,
      client,
    });

    expect(bed.users.rows.get(user.id)?.passwordHash).toBe(`fake-hash:${NEXT}`);
    for (const old of [current, other]) {
      expect(bed.sessions.rows.get(old.id)?.revocationReason).toBe('password_changed');
      expect(await bed.revocationList.isRevoked(old.id)).toBe(true);
    }
    expect(result.sessionId).not.toBe(current.id);
    expect(bed.sessions.rows.get(result.sessionId)?.revokedAt).toBeNull();
    expect(bed.sessions.rows.get(result.sessionId)?.currentToken.tokenHash).toBe(
      bed.secretTokens.hash(result.refreshToken),
    );
    expect(bed.accessTokens.issued.at(-1)).toEqual({
      userId: user.id,
      sessionId: result.sessionId,
    });
    expect(await isUsable(bed, pendingReset)).toBeNull();
    expect(bed.outbox.types()).toEqual([IdentityEventType.passwordChangedNotice]);
    expect(bed.securityEvents.events).toEqual([
      { type: 'auth.password_changed', userId: user.id, revokedSessions: 2 },
    ]);
  });

  it('rejects a wrong current password without changing anything', async () => {
    const { bed, user, current, context } = await seed();

    await expect(
      new ChangePasswordUseCase(bed).execute(context, {
        currentPassword: 'Errada-123!',
        newPassword: NEXT,
        client,
      }),
    ).rejects.toBeInstanceOf(CurrentPasswordIncorrectError);

    expect(bed.users.rows.get(user.id)?.passwordHash).toBe(`fake-hash:${CURRENT}`);
    expect(bed.sessions.rows.get(current.id)?.revokedAt).toBeNull();
    expect(bed.passwordHasher.hashCalls).toBe(0);
  });

  it('BR-011: rejects a weak new password', async () => {
    const { bed, context } = await seed();

    await expect(
      new ChangePasswordUseCase(bed).execute(context, {
        currentPassword: CURRENT,
        newPassword: 'Password1!',
        client,
      }),
    ).rejects.toBeInstanceOf(PasswordPolicyViolationError);
  });

  it('RNF-08 / BR-010: rolls everything back if the revocation list cannot be written', async () => {
    const { bed, user, current, context } = await seed();
    bed.revocationList.failNextRevoke = true;

    await expect(
      new ChangePasswordUseCase(bed).execute(context, {
        currentPassword: CURRENT,
        newPassword: NEXT,
        client,
      }),
    ).rejects.toThrow('redis unavailable');

    expect(bed.users.rows.get(user.id)?.passwordHash).toBe(`fake-hash:${CURRENT}`);
    expect(bed.sessions.rows.get(current.id)?.revokedAt).toBeNull();
    expect(bed.sessions.rows.size).toBe(2);
    expect(bed.outbox.events).toHaveLength(0);
  });
});

describe('RequestPasswordResetUseCase (RF-10, BR-014)', () => {
  const fromHome = { ipAddress: '203.0.113.10', userAgent: null };
  const fromElsewhere = { ipAddress: '198.51.100.7', userAgent: null };

  function useCase(bed: IdentityTestbed) {
    return new RequestPasswordResetUseCase({
      ...bed,
      emailThrottle: new EmailDeliveryThrottle(bed.rateLimiter, bed.pseudonymizer),
    });
  }

  it('BR-014: records the same request whether or not the account exists, without looking it up', async () => {
    const { bed } = await seed();
    const findByEmail = vi.spyOn(bed.users, 'findByEmail');

    await useCase(bed).execute({ email: ' ANA@exemplo.com ', client: fromHome });
    await useCase(bed).execute({ email: 'ninguem@exemplo.com', client: fromHome });

    expect(findByEmail).not.toHaveBeenCalled();
    expect(bed.outbox.events.map(({ type, payload }) => ({ type, payload }))).toEqual([
      { type: IdentityEventType.passwordResetRequested, payload: { email: 'ana@exemplo.com' } },
      { type: IdentityEventType.passwordResetRequested, payload: { email: 'ninguem@exemplo.com' } },
    ]);
  });

  it('silently suppresses repeated requests for the same address', async () => {
    const { bed } = await seed();

    await useCase(bed).execute({ email: 'ana@exemplo.com', client: fromHome });
    await expect(
      useCase(bed).execute({ email: 'ana@exemplo.com', client: fromHome }),
    ).resolves.toBeUndefined();

    expect(bed.outbox.events).toHaveLength(1);
  });

  it("T29/M4: requests from one network do not exhaust the owner's recovery from another", async () => {
    const { bed } = await seed();
    const attacker = { ipAddress: '192.0.2.50', userAgent: null };

    await useCase(bed).execute({ email: 'ana@exemplo.com', client: attacker });
    await useCase(bed).execute({ email: 'ana@exemplo.com', client: attacker }); // suprimido
    await useCase(bed).execute({ email: 'ana@exemplo.com', client: fromElsewhere });

    expect(bed.outbox.events).toHaveLength(2);
  });

  it('T29/M4: caps recovery e-mails per address across all networks (20 per day)', async () => {
    const { bed } = await seed();

    for (let network = 0; network < 25; network += 1) {
      await useCase(bed).execute({
        email: 'ana@exemplo.com',
        client: { ipAddress: `10.0.${network}.1`, userAgent: null },
      });
    }

    expect(bed.outbox.events).toHaveLength(20);
  });

  it('rejects malformed emails (format only — reveals nothing about accounts)', async () => {
    const { bed } = await seed();

    await expect(useCase(bed).execute({ email: 'ana@', client: fromHome })).rejects.toBeInstanceOf(
      InvalidEmailAddressError,
    );
  });
});

describe('ResetPasswordUseCase (RF-11, BR-016)', () => {
  it('RF-11: sets the new password, verifies the email, revokes all sessions and other reset links', async () => {
    const { bed, user, current, other } = await seed();
    const token = await issueToken(bed, user.id);
    const olderLink = await issueToken(bed, user.id);

    await new ResetPasswordUseCase(bed).execute({ token, newPassword: NEXT });

    const stored = bed.users.rows.get(user.id);
    expect(stored?.passwordHash).toBe(`fake-hash:${NEXT}`);
    expect(stored?.emailVerifiedAt).toEqual(bed.clock.now());
    for (const session of [current, other]) {
      expect(bed.sessions.rows.get(session.id)?.revocationReason).toBe('password_reset');
      expect(await bed.revocationList.isRevoked(session.id)).toBe(true);
    }
    expect(await isUsable(bed, token)).toBeNull();
    expect(await isUsable(bed, olderLink)).toBeNull();
    expect(bed.outbox.types()).toEqual([IdentityEventType.passwordChangedNotice]);
    expect(bed.securityEvents.types()).toEqual(['auth.password_reset_completed']);
  });

  it('keeps the link usable when the new password is rejected by BR-011', async () => {
    const { bed, user } = await seed();
    const token = await issueToken(bed, user.id);

    await expect(
      new ResetPasswordUseCase(bed).execute({ token, newPassword: 'Password1!' }),
    ).rejects.toBeInstanceOf(PasswordPolicyViolationError);

    expect(await isUsable(bed, token)).toEqual({ userId: user.id });
  });

  it.each([
    [
      'an expired link (30 min)',
      async (bed: IdentityTestbed, userId: string) => {
        const token = await issueToken(bed, userId);
        bed.clock.advance(30 * 60 * 1000);
        return token;
      },
    ],
    [
      'an email verification link',
      async (bed: IdentityTestbed, userId: string) => issueToken(bed, userId, 'email_verification'),
    ],
    ['an unknown token', async () => 'never-issued'],
  ])('rejects %s without changing the password', async (_case, prepare) => {
    const { bed, user } = await seed();
    const token = await prepare(bed, user.id);

    await expect(
      new ResetPasswordUseCase(bed).execute({ token, newPassword: NEXT }),
    ).rejects.toBeInstanceOf(InvalidOrExpiredTokenError);
    expect(bed.users.rows.get(user.id)?.passwordHash).toBe(`fake-hash:${CURRENT}`);
  });

  it('cannot be used twice', async () => {
    const { bed, user } = await seed();
    const token = await issueToken(bed, user.id);
    await new ResetPasswordUseCase(bed).execute({ token, newPassword: NEXT });

    await expect(
      new ResetPasswordUseCase(bed).execute({ token, newPassword: 'Outra-Senha-9!' }),
    ).rejects.toBeInstanceOf(InvalidOrExpiredTokenError);
  });

  it('RNF-08 / BR-010: if revocation fails, nothing is committed and the link stays usable', async () => {
    const { bed, user, current } = await seed();
    const token = await issueToken(bed, user.id);
    bed.revocationList.failNextRevoke = true;

    await expect(
      new ResetPasswordUseCase(bed).execute({ token, newPassword: NEXT }),
    ).rejects.toThrow('redis unavailable');

    expect(bed.users.rows.get(user.id)?.passwordHash).toBe(`fake-hash:${CURRENT}`);
    expect(bed.sessions.rows.get(current.id)?.revokedAt).toBeNull();
    expect(await isUsable(bed, token)).toEqual({ userId: user.id });
  });
});
