import { randomBytes } from 'node:crypto';
import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { Password, PersonName, User } from '@taskflow/backend/identity/domain';
import { InvalidCredentialsError, LoginUseCase } from '@taskflow/backend/identity/application';
import { createIdentityTestbed } from '@taskflow/backend/identity/application/testing';
import { Argon2PasswordHasher } from './argon2-password-hasher';

const ATTEMPTS_PER_CASE = 20;
const MAX_MEAN_DIFFERENCE_MS = 50;
const client = { ipAddress: '203.0.113.10', userAgent: 'Firefox/140' };

/**
 * CA-04 / BR-014: senha errada e e-mail inexistente custam o mesmo (Argon2 real nos dois casos,
 * contra o hash fictício quando não há conta). Mede o caso de uso, onde a diferença existiria;
 * a consulta ao banco é a mesma busca por e-mail nos dois casos.
 */
describe('Login timing (CA-04, real Argon2)', () => {
  it(`CA-04: wrong password and unknown e-mail differ by less than ${MAX_MEAN_DIFFERENCE_MS} ms on average over ${ATTEMPTS_PER_CASE} attempts`, async () => {
    const bed = createIdentityTestbed();
    const hasher = new Argon2PasswordHasher({ maxConcurrent: 1 });
    await bed.users.add(
      User.register({
        id: bed.idGenerator.generate(),
        email: EmailAddress.create('ana@exemplo.com'),
        name: PersonName.create('Ana'),
        passwordHash: await hasher.hash(Password.fromVerifiedCredential('Senha-Correta-1')),
        now: bed.clock.now(),
      }),
    );
    const login = new LoginUseCase({
      ...bed,
      passwordHasher: hasher,
      dummyPasswordHash: await hasher.hash(
        Password.fromVerifiedCredential(randomBytes(32).toString('base64url')),
      ),
    });

    async function measure(email: string): Promise<number> {
      // Zera o atraso da BR-018: aqui interessa só o custo da verificação.
      bed.loginAttempts.state.clear();
      const started = performance.now();
      await expect(
        login.execute({ email, password: 'Senha-Errada-1', client }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
      return performance.now() - started;
    }

    await measure('ana@exemplo.com'); // aquecimento (JIT, alocação de memória do Argon2)
    const existing: number[] = [];
    const unknown: number[] = [];
    for (let attempt = 0; attempt < ATTEMPTS_PER_CASE; attempt += 1) {
      existing.push(await measure('ana@exemplo.com'));
      unknown.push(await measure(`ninguem-${attempt}@exemplo.com`));
    }

    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const difference = Math.abs(mean(existing) - mean(unknown));
    expect(mean(existing)).toBeGreaterThan(5); // Argon2 de fato executado
    expect(difference).toBeLessThan(MAX_MEAN_DIFFERENCE_MS);
    // O limite do CA é largo para hardware rápido (Argon2 ~10 ms): exige também que o caminho
    // sem conta custe o mesmo que o com conta, senão pular o Argon2 passaria despercebido.
    expect(mean(unknown) / mean(existing)).toBeGreaterThan(0.7);
  }, 60_000);
});
