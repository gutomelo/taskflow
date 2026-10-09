import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { PersonName, User } from '@taskflow/backend/identity/domain';
import {
  createIdentityTestbed,
  readFakeEmail,
  type IdentityTestbed,
} from '../../testing/identity-fakes';
import { SendAccountNoticeUseCase } from './send-account-notice.use-case';
import { SendEmailVerificationUseCase } from './send-email-verification.use-case';
import { SendPasswordResetUseCase } from './send-password-reset.use-case';

async function addUser(bed: IdentityTestbed, email: string, options: { verified?: boolean } = {}) {
  const user = User.register({
    id: bed.idGenerator.generate(),
    email: EmailAddress.create(email),
    name: PersonName.create('Ana <b>Souza</b>'),
    passwordHash: 'fake-hash:x',
    now: bed.clock.now(),
  });
  if (options.verified) user.verifyEmail(bed.clock.now());
  await bed.users.add(user);
  return user;
}

function tokenFrom(link: unknown, path: string): string {
  const prefix = `https://app.taskflow.test${path}#token=`;
  if (typeof link !== 'string' || !link.startsWith(prefix)) {
    throw new Error(`Unexpected link: ${String(link)}`);
  }
  return decodeURIComponent(link.slice(prefix.length));
}

const tokensOfEvent = (bed: IdentityTestbed, eventId: string) =>
  [...bed.userTokens.rows.values()].filter((row) => row.sourceEventId === eventId);

describe('SendEmailVerificationUseCase', () => {
  async function setup() {
    const bed = createIdentityTestbed();
    const ana = await addUser(bed, 'ana@exemplo.com');
    return { bed, ana, send: new SendEmailVerificationUseCase(bed) };
  }

  it('emails a 24 h verification link whose token belongs to the user (CA-01)', async () => {
    const { bed, ana, send } = await setup();

    expect(await send.execute({ eventId: 'event-1', userId: ana.id })).toEqual({ status: 'sent' });

    const email = readFakeEmail(bed.emailSender.sent[0]);
    expect(bed.emailSender.sent[0]?.to.value).toBe('ana@exemplo.com');
    expect(email).toMatchObject({ template: 'emailVerification', validForHours: 24 });
    const token = tokenFrom(email['link'], '/verify-email');
    const owner = await bed.userTokens.findOwner(
      bed.secretTokens.hash(token),
      'email_verification',
      bed.clock.now(),
    );
    expect(owner).toEqual({ userId: ana.id });
  });

  it('greets unverified accounts generically: the name may not be the owner’s', async () => {
    const { bed, ana, send } = await setup();

    await send.execute({ eventId: 'event-1', userId: ana.id });

    expect(readFakeEmail(bed.emailSender.sent[0])['name']).toBeNull();
  });

  it('issues a new token on retry after a send failure; only the last link works', async () => {
    const { bed, ana, send } = await setup();
    bed.emailSender.failNext();

    await expect(send.execute({ eventId: 'event-1', userId: ana.id })).rejects.toThrow('SMTP');
    await send.execute({ eventId: 'event-1', userId: ana.id });

    const [failed, delivered] = bed.emailSender.attempted.map((message) =>
      tokenFrom(readFakeEmail(message)['link'], '/verify-email'),
    );
    expect(failed).not.toBe(delivered);
    expect(tokensOfEvent(bed, 'event-1')).toHaveLength(1);
    const ownerOf = (token: string | undefined) =>
      bed.userTokens.findOwner(
        bed.secretTokens.hash(token ?? ''),
        'email_verification',
        bed.clock.now(),
      );
    expect(await ownerOf(failed)).toBeNull();
    expect(await ownerOf(delivered)).toEqual({ userId: ana.id });
  });

  it('keeps a single token per event when the event is reprocessed (CA-13)', async () => {
    const { bed, ana, send } = await setup();

    await send.execute({ eventId: 'event-1', userId: ana.id });
    await send.execute({ eventId: 'event-1', userId: ana.id });

    expect(tokensOfEvent(bed, 'event-1')).toHaveLength(1);
  });

  it('does not email a dead link when the event token was already used', async () => {
    const { bed, ana, send } = await setup();
    await send.execute({ eventId: 'event-1', userId: ana.id });
    const token = tokenFrom(readFakeEmail(bed.emailSender.sent[0])['link'], '/verify-email');
    await bed.userTokens.consume(
      bed.secretTokens.hash(token),
      'email_verification',
      bed.clock.now(),
    );

    const outcome = await send.execute({ eventId: 'event-1', userId: ana.id });

    expect(outcome).toEqual({ status: 'discarded', reason: 'token_already_used' });
    expect(bed.emailSender.sent).toHaveLength(1);
  });

  it('discards events for missing or already verified accounts without issuing tokens', async () => {
    const bed = createIdentityTestbed();
    const verified = await addUser(bed, 'bia@exemplo.com', { verified: true });
    const send = new SendEmailVerificationUseCase(bed);

    expect(await send.execute({ eventId: 'event-1', userId: 'missing' })).toEqual({
      status: 'discarded',
      reason: 'user_not_found',
    });
    expect(await send.execute({ eventId: 'event-2', userId: verified.id })).toEqual({
      status: 'discarded',
      reason: 'email_already_verified',
    });
    expect(bed.emailSender.attempted).toHaveLength(0);
    expect(bed.userTokens.rows.size).toBe(0);
  });
});

describe('SendPasswordResetUseCase', () => {
  it('emails a 30 min reset link to the account owner, by name when verified', async () => {
    const bed = createIdentityTestbed();
    const ana = await addUser(bed, 'ana@exemplo.com', { verified: true });

    await new SendPasswordResetUseCase(bed).execute({
      eventId: 'event-1',
      email: 'ana@exemplo.com',
    });

    const email = readFakeEmail(bed.emailSender.sent[0]);
    expect(email).toMatchObject({
      template: 'passwordReset',
      validForMinutes: 30,
      name: 'Ana <b>Souza</b>',
    });
    const token = tokenFrom(email['link'], '/reset-password');
    expect(
      await bed.userTokens.findOwner(
        bed.secretTokens.hash(token),
        'password_reset',
        bed.clock.now(),
      ),
    ).toEqual({ userId: ana.id });
    expect(
      await bed.userTokens.findOwner(
        bed.secretTokens.hash(token),
        'email_verification',
        bed.clock.now(),
      ),
    ).toBeNull();
  });

  it('silently discards requests for addresses without an account (BR-014)', async () => {
    const bed = createIdentityTestbed();
    const send = new SendPasswordResetUseCase(bed);

    expect(await send.execute({ eventId: 'event-1', email: 'ninguem@exemplo.com' })).toEqual({
      status: 'discarded',
      reason: 'user_not_found',
    });
    expect(await send.execute({ eventId: 'event-2', email: 'not an email' })).toEqual({
      status: 'discarded',
      reason: 'invalid_email',
    });
    expect(bed.emailSender.attempted).toHaveLength(0);
    expect(bed.userTokens.rows.size).toBe(0);
  });
});

describe('SendAccountNoticeUseCase', () => {
  it('tells the owner someone tried to register the address, without a verification link (CA-02)', async () => {
    const bed = createIdentityTestbed();
    const ana = await addUser(bed, 'ana@exemplo.com', { verified: true });

    await new SendAccountNoticeUseCase(bed).execute({
      userId: ana.id,
      notice: 'account_already_exists',
    });

    expect(readFakeEmail(bed.emailSender.sent[0])).toEqual({
      template: 'accountAlreadyExists',
      name: 'Ana <b>Souza</b>',
      loginLink: 'https://app.taskflow.test/login',
      forgotPasswordLink: 'https://app.taskflow.test/forgot-password',
    });
    expect(bed.userTokens.rows.size).toBe(0);
  });

  it('notifies password changes with a recovery link', async () => {
    const bed = createIdentityTestbed();
    const ana = await addUser(bed, 'ana@exemplo.com');

    await new SendAccountNoticeUseCase(bed).execute({ userId: ana.id, notice: 'password_changed' });

    expect(readFakeEmail(bed.emailSender.sent[0])).toEqual({
      template: 'passwordChanged',
      name: null,
      forgotPasswordLink: 'https://app.taskflow.test/forgot-password',
    });
  });

  it('discards notices for accounts that no longer exist', async () => {
    const bed = createIdentityTestbed();

    expect(
      await new SendAccountNoticeUseCase(bed).execute({
        userId: 'missing',
        notice: 'password_changed',
      }),
    ).toEqual({ status: 'discarded', reason: 'user_not_found' });
    expect(bed.emailSender.attempted).toHaveLength(0);
  });
});
