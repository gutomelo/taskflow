import { InvalidEmailAddressError } from '@taskflow/backend/shared/kernel';
import {
  InvalidPersonNameError,
  PasswordPolicyViolationError,
} from '@taskflow/backend/identity/domain';
import { createIdentityTestbed, type IdentityTestbed } from '../../testing/identity-fakes';
import { EmailDeliveryThrottle } from '../shared/email-delivery-throttle';
import { IdentityEventType } from '../shared/identity-events';
import { RegisterUserUseCase } from './register-user.use-case';

const command = { name: ' Ana  Souza ', email: ' Ana@Exemplo.com ', password: 'Tr0ca-de-Senha' };

function setup() {
  const bed = createIdentityTestbed();
  const useCase = new RegisterUserUseCase({
    ...bed,
    emailThrottle: new EmailDeliveryThrottle(bed.rateLimiter, bed.pseudonymizer),
  });
  return { bed, useCase };
}

const storedUsers = (bed: IdentityTestbed) => [...bed.users.rows.values()];

describe('RegisterUserUseCase', () => {
  it('RF-01: creates an unverified user with normalized email and name, never storing the plain password', async () => {
    const { bed, useCase } = setup();

    await useCase.execute(command);

    const [user] = storedUsers(bed);
    expect(user).toMatchObject({
      emailVerifiedAt: null,
      version: 1,
      passwordHash: 'fake-hash:Tr0ca-de-Senha',
    });
    expect(user?.email.value).toBe('ana@exemplo.com');
    expect(user?.name.value).toBe('Ana Souza');
  });

  it('RF-02: records the verification email request in the outbox within the same transaction', async () => {
    const { bed, useCase } = setup();

    await useCase.execute(command);

    expect(bed.outbox.types()).toEqual([IdentityEventType.emailVerificationRequested]);
    expect(bed.outbox.events[0]?.payload).toEqual({ userId: storedUsers(bed)[0]?.id });
    expect(bed.transactions.commits).toBe(1);
  });

  it('BR-014: answers the same way for an existing account, sending a notice instead of a link', async () => {
    const { bed, useCase } = setup();
    await useCase.execute(command);
    const existing = storedUsers(bed)[0];
    bed.rateLimiter.consumed.clear();

    await expect(
      useCase.execute({ ...command, name: 'Outra Pessoa', password: 'Outr4-Senha!' }),
    ).resolves.toBeUndefined();

    expect(storedUsers(bed)).toEqual([existing]);
    expect(bed.outbox.types()).toEqual([
      IdentityEventType.emailVerificationRequested,
      IdentityEventType.accountAlreadyExistsNotice,
    ]);
  });

  it('BR-014: hashes the password even when the account already exists (constant work)', async () => {
    const { bed, useCase } = setup();
    await useCase.execute(command);

    await useCase.execute(command);

    expect(bed.passwordHasher.hashCalls).toBe(2);
  });

  it('BR-014: silently suppresses repeated emails to the same address, keeping the same answer', async () => {
    const { bed, useCase } = setup();
    await useCase.execute(command);

    await expect(useCase.execute(command)).resolves.toBeUndefined();

    expect(bed.outbox.types()).toEqual([IdentityEventType.emailVerificationRequested]);
  });

  it('keys the email throttle by a pseudonym, never by the plain address', async () => {
    const { bed, useCase } = setup();

    await useCase.execute(command);

    expect(bed.rateLimiter.keys().some((key) => key.includes('ana@exemplo.com'))).toBe(false);
  });

  it('BR-014: a concurrent registration that loses the race gets the same answer and no extra email', async () => {
    const { bed, useCase } = setup();
    bed.users.failNextAddWithDuplicate = true;

    await expect(useCase.execute(command)).resolves.toBeUndefined();

    expect(bed.outbox.events).toHaveLength(0);
  });

  it('BR-011: rejects a weak password before hashing or touching storage', async () => {
    const { bed, useCase } = setup();

    await expect(useCase.execute({ ...command, password: 'Password1!' })).rejects.toBeInstanceOf(
      PasswordPolicyViolationError,
    );
    expect(bed.passwordHasher.hashCalls).toBe(0);
    expect(storedUsers(bed)).toHaveLength(0);
  });

  it('rejects malformed emails and names', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ ...command, email: 'ana@' })).rejects.toBeInstanceOf(
      InvalidEmailAddressError,
    );
    await expect(useCase.execute({ ...command, name: '   ' })).rejects.toBeInstanceOf(
      InvalidPersonNameError,
    );
  });

  it('propagates unexpected storage failures instead of hiding them as duplicates', async () => {
    const { bed, useCase } = setup();
    bed.users.add = async () => {
      throw new Error('connection reset');
    };

    await expect(useCase.execute(command)).rejects.toThrow('connection reset');
  });

  it('BR-010: rolls back the user if recording the event fails', async () => {
    const { bed, useCase } = setup();
    bed.outbox.append = async () => {
      throw new Error('outbox write failed');
    };

    await expect(useCase.execute(command)).rejects.toThrow('outbox write failed');
    expect(storedUsers(bed)).toHaveLength(0);
  });
});
