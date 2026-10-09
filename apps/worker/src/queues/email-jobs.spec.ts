import { UnrecoverableError, type Job } from 'bullmq';
import { pino } from 'pino';
import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { PersonName, User } from '@taskflow/backend/identity/domain';
import {
  IdentityEventType,
  SendAccountNoticeUseCase,
  SendEmailVerificationUseCase,
  SendPasswordResetUseCase,
} from '@taskflow/backend/identity/application';
import {
  createIdentityTestbed,
  readFakeEmail,
} from '@taskflow/backend/identity/application/testing';
import type { OutboxJobData } from '@taskflow/backend/shared/infrastructure';
import { createEmailJobProcessor, describeJobError } from './email-jobs';

const EVENT_ID = '01a11e1a-9a02-730e-9858-639ea281969b';
const USER_ID = '01a11e1a-99fa-7501-a131-4ad99a122005';

async function setup() {
  const bed = createIdentityTestbed();
  await bed.users.add(
    User.register({
      id: USER_ID,
      email: EmailAddress.create('ana@exemplo.com'),
      name: PersonName.create('Ana'),
      passwordHash: 'fake-hash:x',
      now: bed.clock.now(),
    }),
  );
  const process = createEmailJobProcessor(
    {
      sendEmailVerification: new SendEmailVerificationUseCase(bed),
      sendPasswordReset: new SendPasswordResetUseCase(bed),
      sendAccountNotice: new SendAccountNoticeUseCase(bed),
    },
    pino({ level: 'silent' }),
  );
  return { bed, process };
}

function job(data: Partial<OutboxJobData> & Record<string, unknown>): Job<OutboxJobData> {
  const full = { eventId: EVENT_ID, occurredAt: '2026-10-09T00:00:00.000Z', ...data };
  // O processador só lê `data` e `attemptsMade`; o restante do Job do BullMQ não é usado.
  return { data: full, attemptsMade: 0 } as unknown as Job<OutboxJobData>;
}

describe('email job processor', () => {
  it.each([
    [IdentityEventType.emailVerificationRequested, { userId: USER_ID }, 'emailVerification'],
    [IdentityEventType.accountAlreadyExistsNotice, { userId: USER_ID }, 'accountAlreadyExists'],
    [IdentityEventType.passwordChangedNotice, { userId: USER_ID }, 'passwordChanged'],
    [IdentityEventType.passwordResetRequested, { email: 'ana@exemplo.com' }, 'passwordReset'],
  ])('dispatches %s to its use case', async (type, payload, template) => {
    const { bed, process } = await setup();

    expect(await process(job({ type, payload }))).toEqual({ status: 'sent' });

    expect(readFakeEmail(bed.emailSender.sent[0])['template']).toBe(template);
  });

  it.each([
    ['unknown type', { type: 'identity.unknown', payload: { userId: USER_ID } }],
    [
      'payload of another type',
      { type: IdentityEventType.passwordResetRequested, payload: { userId: USER_ID } },
    ],
    [
      'malformed user id',
      { type: IdentityEventType.emailVerificationRequested, payload: { userId: 'x' } },
    ],
    [
      'malformed event id',
      {
        type: IdentityEventType.passwordChangedNotice,
        payload: { userId: USER_ID },
        eventId: '42',
      },
    ],
  ])('rejects a job with %s without retry and without sending', async (_case, data) => {
    const { bed, process } = await setup();

    await expect(process(job(data))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(bed.emailSender.attempted).toHaveLength(0);
  });

  it('propagates send failures so the queue retries the job', async () => {
    const { bed, process } = await setup();
    bed.emailSender.failNext();

    await expect(
      process(job({ type: IdentityEventType.passwordChangedNotice, payload: { userId: USER_ID } })),
    ).rejects.toThrow('SMTP unavailable');
  });
});

describe('describeJobError', () => {
  it('omits the message of coded SMTP errors, which may contain e-mail addresses', () => {
    const error = Object.assign(new Error("Can't send mail - recipient ana@exemplo.com rejected"), {
      code: 'EENVELOPE',
      responseCode: 550,
    });

    const described = describeJobError(error);

    expect(described).toEqual({ errorName: 'Error', errorCode: 'EENVELOPE', responseCode: 550 });
    expect(JSON.stringify(described)).not.toContain('ana@exemplo.com');
  });

  it('keeps uncoded errors whole for debugging', () => {
    const error = new TypeError('boom');

    expect(describeJobError(error)).toEqual({ err: error });
  });
});
