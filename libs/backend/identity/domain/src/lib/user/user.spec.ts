import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { PersonName } from './person-name';
import { EmailAlreadyVerifiedError, User } from './user';

const registeredAt = new Date('2026-10-08T10:00:00.000Z');
const later = new Date('2026-10-08T11:00:00.000Z');

function registerUser(): User {
  return User.register({
    id: '01920000-0000-7000-8000-000000000001',
    email: EmailAddress.create('ana@exemplo.com'),
    name: PersonName.create('Ana'),
    passwordHash: '$argon2id$hash-1',
    now: registeredAt,
  });
}

describe('User', () => {
  it('registers with an unverified email and version 1', () => {
    const user = registerUser();

    expect(user.isEmailVerified).toBe(false);
    expect(user.toSnapshot()).toMatchObject({
      emailVerifiedAt: null,
      passwordChangedAt: registeredAt,
      createdAt: registeredAt,
      version: 1,
    });
  });

  it('exposes its identity, email and name', () => {
    const user = registerUser();

    expect(user.id).toBe('01920000-0000-7000-8000-000000000001');
    expect(user.email.value).toBe('ana@exemplo.com');
    expect(`${user.name}`).toBe('Ana');
  });

  it('verifies the email once', () => {
    const user = registerUser();

    user.verifyEmail(later);

    expect(user.isEmailVerified).toBe(true);
    expect(user.toSnapshot().emailVerifiedAt).toEqual(later);
  });

  it('rejects verifying an already verified email', () => {
    const user = registerUser();
    user.verifyEmail(later);

    expect(() => user.verifyEmail(later)).toThrow(EmailAlreadyVerifiedError);
  });

  it('marks the email as verified on password reset, idempotently (RF-11)', () => {
    const user = registerUser();

    user.markEmailVerifiedByReset(later);
    user.markEmailVerifiedByReset(new Date('2026-10-09T00:00:00.000Z'));

    expect(user.toSnapshot().emailVerifiedAt).toEqual(later);
  });

  it('changes the password hash and records when (BR-016)', () => {
    const user = registerUser();

    user.changePassword('$argon2id$hash-2', later);

    expect(user.passwordHash).toBe('$argon2id$hash-2');
    expect(user.toSnapshot().passwordChangedAt).toEqual(later);
  });

  it('restores persisted state without revalidating creation rules', () => {
    const snapshot = { ...registerUser().toSnapshot(), emailVerifiedAt: later, version: 7 };

    expect(User.restore(snapshot).toSnapshot()).toEqual(snapshot);
  });
});
