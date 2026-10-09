import { EmailAddress } from '@taskflow/backend/shared/kernel';
import {
  EmailAlreadyVerifiedError,
  InvalidOrExpiredTokenError,
  PersonName,
  SessionRevokedError,
  User,
  UserToken,
  type UserTokenPurpose,
} from '@taskflow/backend/identity/domain';
import { createIdentityTestbed, type IdentityTestbed } from '../../testing/identity-fakes';
import { EmailDeliveryThrottle } from '../shared/email-delivery-throttle';
import { TokenBelongsToAnotherAccountError } from '../shared/identity-errors';
import { IdentityEventType } from '../shared/identity-events';
import { ConfirmEmailVerificationUseCase } from './confirm-email-verification.use-case';
import { GetUserVerificationStatusUseCase } from './get-user-verification-status.use-case';
import { ResendEmailVerificationUseCase } from './resend-email-verification.use-case';

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

/** Simula o worker emitindo o link por e-mail; devolve o token bruto. */
async function issueToken(
  bed: IdentityTestbed,
  userId: string,
  purpose: UserTokenPurpose = 'email_verification',
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

const contextFor = (userId: string) => ({
  requestId: 'req-1',
  actor: { userId, sessionId: 'session-1' },
});

describe('ConfirmEmailVerificationUseCase', () => {
  async function setup() {
    const bed = createIdentityTestbed();
    const ana = await addUser(bed, 'ana@exemplo.com');
    return { bed, ana, confirm: new ConfirmEmailVerificationUseCase(bed) };
  }

  it('RF-03: verifies the email of the authenticated owner and consumes the link', async () => {
    const { bed, ana, confirm } = await setup();
    const token = await issueToken(bed, ana.id);

    await confirm.execute(contextFor(ana.id), { token });

    expect(bed.users.rows.get(ana.id)?.emailVerifiedAt).toEqual(bed.clock.now());
    expect(
      await bed.userTokens.findOwner(
        bed.secretTokens.hash(token),
        'email_verification',
        bed.clock.now(),
      ),
    ).toBeNull();
  });

  it('BR-017 / CA-16: refuses a link of another account without consuming it (account pre-hijacking)', async () => {
    const { bed, confirm } = await setup();
    // Atacante cadastrou o e-mail da vítima; a vítima recebe o link, mas está logada na própria conta.
    const preHijacked = await addUser(bed, 'vitima@exemplo.com');
    const victimOwnAccount = await addUser(bed, 'vitima.real@exemplo.com');
    const token = await issueToken(bed, preHijacked.id);

    await expect(
      confirm.execute(contextFor(victimOwnAccount.id), { token }),
    ).rejects.toBeInstanceOf(TokenBelongsToAnotherAccountError);

    expect(bed.users.rows.get(preHijacked.id)?.emailVerifiedAt).toBeNull();
    expect(bed.users.rows.get(victimOwnAccount.id)?.emailVerifiedAt).toBeNull();
    expect(
      await bed.userTokens.findOwner(
        bed.secretTokens.hash(token),
        'email_verification',
        bed.clock.now(),
      ),
    ).toEqual({
      userId: preHijacked.id,
    });
  });

  it('answers EMAIL_ALREADY_VERIFIED on a double click, without touching the token', async () => {
    const { bed, ana, confirm } = await setup();
    const first = await issueToken(bed, ana.id);
    const second = await issueToken(bed, ana.id);
    await confirm.execute(contextFor(ana.id), { token: first });

    await expect(confirm.execute(contextFor(ana.id), { token: first })).rejects.toBeInstanceOf(
      EmailAlreadyVerifiedError,
    );
    expect(
      await bed.userTokens.findOwner(
        bed.secretTokens.hash(second),
        'email_verification',
        bed.clock.now(),
      ),
    ).not.toBeNull();
  });

  it.each([
    [
      'an expired link (24 h)',
      async (bed: IdentityTestbed, userId: string) => {
        const token = await issueToken(bed, userId);
        bed.clock.advance(24 * 60 * 60 * 1000);
        return token;
      },
    ],
    [
      'a password reset link',
      async (bed: IdentityTestbed, userId: string) => issueToken(bed, userId, 'password_reset'),
    ],
    ['an unknown token', async () => 'never-issued'],
  ])('rejects %s with INVALID_OR_EXPIRED_TOKEN', async (_case, prepare) => {
    const { bed, ana, confirm } = await setup();
    const token = await prepare(bed, ana.id);

    await expect(confirm.execute(contextFor(ana.id), { token })).rejects.toBeInstanceOf(
      InvalidOrExpiredTokenError,
    );
    expect(bed.users.rows.get(ana.id)?.emailVerifiedAt).toBeNull();
  });

  it('treats a session whose user no longer exists as revoked', async () => {
    const { confirm } = await setup();

    await expect(confirm.execute(contextFor('ghost'), { token: 'x' })).rejects.toBeInstanceOf(
      SessionRevokedError,
    );
  });
});

describe('ResendEmailVerificationUseCase', () => {
  async function setup() {
    const bed = createIdentityTestbed();
    const ana = await addUser(bed, 'ana@exemplo.com');
    const resend = new ResendEmailVerificationUseCase({
      ...bed,
      emailThrottle: new EmailDeliveryThrottle(bed.rateLimiter, bed.pseudonymizer),
    });
    return { bed, ana, resend };
  }

  it('RF-04: records a new verification email request for an unverified user', async () => {
    const { bed, ana, resend } = await setup();

    await resend.execute(contextFor(ana.id));

    expect(bed.outbox.types()).toEqual([IdentityEventType.emailVerificationRequested]);
    expect(bed.outbox.events[0]?.payload).toEqual({ userId: ana.id });
  });

  it('refuses when the email is already verified', async () => {
    const { bed, ana, resend } = await setup();
    const loaded = await bed.users.findById(ana.id);
    loaded?.verifyEmail(bed.clock.now());
    if (loaded) await bed.users.save(loaded);

    await expect(resend.execute(contextFor(ana.id))).rejects.toBeInstanceOf(
      EmailAlreadyVerifiedError,
    );
  });

  it('BR-014: silently suppresses repeated requests to the same address', async () => {
    const { bed, ana, resend } = await setup();
    await resend.execute(contextFor(ana.id));

    await expect(resend.execute(contextFor(ana.id))).resolves.toBeUndefined();
    expect(bed.outbox.events).toHaveLength(1);
  });

  it('treats a session whose user no longer exists as revoked', async () => {
    const { resend } = await setup();

    await expect(resend.execute(contextFor('ghost'))).rejects.toBeInstanceOf(SessionRevokedError);
  });
});

describe('GetUserVerificationStatusUseCase (BR-013, for spec 002)', () => {
  it('reports verification status, or null for unknown users', async () => {
    const bed = createIdentityTestbed();
    const ana = await addUser(bed, 'ana@exemplo.com');
    const status = new GetUserVerificationStatusUseCase(bed);

    expect(await status.execute(ana.id)).toEqual({ emailVerified: false });
    const loaded = await bed.users.findById(ana.id);
    loaded?.verifyEmail(bed.clock.now());
    if (loaded) await bed.users.save(loaded);
    expect(await status.execute(ana.id)).toEqual({ emailVerified: true });
    expect(await status.execute('ghost')).toBeNull();
  });
});
