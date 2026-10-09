import { RateLimitedError } from '@taskflow/backend/shared/application';
import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { PersonName, User } from '@taskflow/backend/identity/domain';
import { createIdentityTestbed, type IdentityTestbed } from '../../testing/identity-fakes';
import { InvalidCredentialsError } from '../shared/identity-errors';
import { LoginUseCase } from './login.use-case';

const DUMMY_HASH = 'fake-hash:dummy-random-value';
const client = { ipAddress: '203.0.113.77', userAgent: 'Firefox/140' };

async function setup(passwordHash = 'fake-hash:Tr0ca-de-Senha') {
  const bed = createIdentityTestbed();
  const user = User.register({
    id: bed.idGenerator.generate(),
    email: EmailAddress.create('ana@exemplo.com'),
    name: PersonName.create('Ana'),
    passwordHash,
    now: bed.clock.now(),
  });
  await bed.users.add(user);
  const useCase = new LoginUseCase({ ...bed, dummyPasswordHash: DUMMY_HASH });
  return { bed, user, useCase };
}

const sessionsOf = (bed: IdentityTestbed) => [...bed.sessions.rows.values()];

describe('LoginUseCase', () => {
  it('RF-05: authenticates and starts a session, returning tokens and the public user view', async () => {
    const { bed, user, useCase } = await setup();

    const result = await useCase.execute({
      email: ' ANA@exemplo.com',
      password: 'Tr0ca-de-Senha',
      client,
    });

    expect(result.user).toEqual({
      id: user.id,
      name: 'Ana',
      email: 'ana@exemplo.com',
      emailVerified: false,
    });
    const [session] = sessionsOf(bed);
    expect(session).toMatchObject({ id: result.sessionId, userId: user.id });
    expect(bed.accessTokens.issued).toEqual([{ userId: user.id, sessionId: result.sessionId }]);
    expect(result.refreshTokenExpiresAt).toEqual(session?.idleExpiresAt);
  });

  it('RNF-02: persists only the refresh token hash, never the raw token', async () => {
    const { bed, useCase } = await setup();

    const { refreshToken } = await useCase.execute({
      email: 'ana@exemplo.com',
      password: 'Tr0ca-de-Senha',
      client,
    });

    const [session] = sessionsOf(bed);
    expect(session?.currentToken.tokenHash).toBe(bed.secretTokens.hash(refreshToken));
    expect(JSON.stringify(session)).not.toContain(refreshToken);
  });

  it('minimizes client data: IP prefix only, user agent truncated', async () => {
    const { bed, useCase } = await setup();

    await useCase.execute({
      email: 'ana@exemplo.com',
      password: 'Tr0ca-de-Senha',
      client: { ipAddress: '203.0.113.77', userAgent: 'x'.repeat(400) },
    });

    expect(sessionsOf(bed)[0]?.client).toEqual({
      ipPrefix: '203.0.113.0/24',
      userAgent: 'x'.repeat(256),
    });
  });

  it('allows login before email verification (BR-013 applies only to organizations)', async () => {
    const { useCase } = await setup();

    await expect(
      useCase.execute({ email: 'ana@exemplo.com', password: 'Tr0ca-de-Senha', client }),
    ).resolves.toMatchObject({ user: { emailVerified: false } });
  });

  it.each([
    ['a wrong password', 'ana@exemplo.com', 'Senha-Errada1!'],
    ['an unknown email', 'ninguem@exemplo.com', 'Tr0ca-de-Senha'],
    ['a malformed email', 'not-an-email', 'Tr0ca-de-Senha'],
  ])(
    'BR-014: rejects %s with the same INVALID_CREDENTIALS error and no session',
    async (_case, email, password) => {
      const { bed, useCase } = await setup();

      await expect(useCase.execute({ email, password, client })).rejects.toBeInstanceOf(
        InvalidCredentialsError,
      );
      expect(sessionsOf(bed)).toHaveLength(0);
      expect(bed.passwordHasher.verifyCalls).toHaveLength(1);
    },
  );

  it('RNF-06: verifies against the dummy hash when the account does not exist (same Argon2 cost)', async () => {
    const { bed, useCase } = await setup();

    await expect(
      useCase.execute({ email: 'ninguem@exemplo.com', password: 'Tr0ca-de-Senha', client }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(bed.passwordHasher.verifyCalls).toEqual([
      { passwordHash: DUMMY_HASH, candidate: 'Tr0ca-de-Senha' },
    ]);
  });

  it('rehashes an outdated password hash transparently, without recording a password change', async () => {
    const { bed, user, useCase } = await setup('legacy:Old-Secret1');

    await useCase.execute({ email: 'ana@exemplo.com', password: 'Old-Secret1', client });

    const stored = bed.users.rows.get(user.id);
    expect(stored?.passwordHash).toBe('fake-hash:Old-Secret1');
    expect(stored?.passwordChangedAt).toEqual(user.toSnapshot().passwordChangedAt);
  });

  it('surfaces unexpected rehash failures (only version conflicts are tolerated)', async () => {
    const { bed, useCase } = await setup('legacy:Old-Secret1');
    bed.users.save = async () => {
      throw new Error('database down');
    };

    await expect(
      useCase.execute({ email: 'ana@exemplo.com', password: 'Old-Secret1', client }),
    ).rejects.toThrow('database down');
  });

  it('never fails the login because a concurrent update blocked the rehash', async () => {
    const { bed, useCase } = await setup('legacy:Old-Secret1');
    bed.users.failNextSaveWithConflict = true;

    await expect(
      useCase.execute({ email: 'ana@exemplo.com', password: 'Old-Secret1', client }),
    ).resolves.toMatchObject({ sessionId: expect.any(String) });
  });

  describe('progressive delay (BR-018)', () => {
    const attempt = (useCase: LoginUseCase, password: string, email = 'ana@exemplo.com') =>
      useCase.execute({ email, password, client });

    async function failTimes(useCase: LoginUseCase, times: number, email?: string) {
      for (let index = 0; index < times; index += 1) {
        await expect(attempt(useCase, 'Senha-Errada1!', email)).rejects.toBeInstanceOf(
          InvalidCredentialsError,
        );
      }
    }

    it('BR-018: after 5 consecutive failures, even the correct password must wait 1 s (429)', async () => {
      const { bed, useCase } = await setup();
      await failTimes(useCase, 5);
      const verifyCallsBefore = bed.passwordHasher.verifyCalls.length;

      const blocked = attempt(useCase, 'Tr0ca-de-Senha');

      await expect(blocked).rejects.toBeInstanceOf(RateLimitedError);
      await expect(blocked).rejects.toMatchObject({ retryAfterSeconds: 1 });
      expect(bed.passwordHasher.verifyCalls).toHaveLength(verifyCallsBefore);
    });

    it('BR-018: doubles the wait on each further failure', async () => {
      const { bed, useCase } = await setup();
      await failTimes(useCase, 5);
      bed.clock.advance(1_000);
      await failTimes(useCase, 1);

      await expect(attempt(useCase, 'Tr0ca-de-Senha')).rejects.toMatchObject({
        retryAfterSeconds: 2,
      });
    });

    it('BR-018: allows the attempt once the wait is over, and a success resets the counter', async () => {
      const { bed, useCase } = await setup();
      await failTimes(useCase, 5);
      bed.clock.advance(1_000);

      await expect(attempt(useCase, 'Tr0ca-de-Senha')).resolves.toMatchObject({
        sessionId: expect.any(String),
      });
      await failTimes(useCase, 4);
      await expect(attempt(useCase, 'Tr0ca-de-Senha')).resolves.toBeDefined();
    });

    it('BR-014 / BR-018: treats unknown accounts the same way (no enumeration through the delay)', async () => {
      const { useCase } = await setup();
      await failTimes(useCase, 5, 'ninguem@exemplo.com');

      await expect(attempt(useCase, 'Qualquer-1!', 'ninguem@exemplo.com')).rejects.toBeInstanceOf(
        RateLimitedError,
      );
    });

    it('keys the counter by a pseudonym of the normalized email, never the plain address', async () => {
      const { bed, useCase } = await setup();
      await failTimes(useCase, 1, ' ANA@Exemplo.com ');
      await failTimes(useCase, 1, 'ana@exemplo.com');

      const keys = [...bed.loginAttempts.state.keys()];
      expect(keys).toHaveLength(1);
      expect(keys[0]).not.toContain('ana@exemplo.com');
      expect(bed.loginAttempts.state.get(keys[0] ?? '')?.consecutiveFailures).toBe(2);
    });
  });
});
