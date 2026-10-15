import { hash as argon2Hash, argon2i } from 'argon2';
import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { ServiceBusyError } from '@taskflow/backend/shared/application';
import { Password } from '@taskflow/backend/identity/domain';
import { Argon2PasswordHasher } from './argon2-password-hasher';

const context = {
  email: EmailAddress.create('ana@exemplo.com'),
  commonPasswords: { contains: () => false },
};
const password = (raw: string) => Password.create(raw, context);

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher({ maxConcurrent: 4 });

  it('RNF-01: hashes with Argon2id and OWASP parameters (m=19 MiB, t=2, p=1)', async () => {
    const digest = await hasher.hash(password('Tr0ca-de-Senha'));

    const [, algorithm, version, parameters] = digest.split('$');
    expect(algorithm).toBe('argon2id');
    expect(version).toBe('v=19');
    expect(parameters?.split(',').sort()).toEqual(['m=19456', 'p=1', 't=2']);
    expect(digest).not.toContain('Tr0ca-de-Senha');
  });

  it('salts every hash: the same password never produces the same digest', async () => {
    const [first, second] = await Promise.all([
      hasher.hash(password('Tr0ca-de-Senha')),
      hasher.hash(password('Tr0ca-de-Senha')),
    ]);

    expect(first).not.toBe(second);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const digest = await hasher.hash(password('Tr0ca-de-Senha'));

    expect(await hasher.verify(digest, 'Tr0ca-de-Senha')).toBe(true);
    expect(await hasher.verify(digest, 'tr0ca-de-senha')).toBe(false);
  });

  it('accepts the same password typed with another Unicode composition (NFC)', async () => {
    const digest = await hasher.hash(password('São-Paulo1'));

    expect(await hasher.verify(digest, 'São-Paulo1')).toBe(true);
  });

  it('treats a malformed stored hash as a failed verification, not an error', async () => {
    expect(await hasher.verify('not-a-hash', 'Tr0ca-de-Senha')).toBe(false);
  });

  it('asks for rehash when parameters or algorithm are outdated', async () => {
    const current = await hasher.hash(password('Tr0ca-de-Senha'));
    const weaker = await argon2Hash('Tr0ca-de-Senha', {
      memoryCost: 4096,
      timeCost: 1,
      parallelism: 1,
    });
    const wrongVariant = await argon2Hash('Tr0ca-de-Senha', { type: argon2i });

    expect(hasher.needsRehash(current)).toBe(false);
    expect(hasher.needsRehash(weaker)).toBe(true);
    expect(hasher.needsRehash(wrongVariant)).toBe(true);
    expect(hasher.needsRehash('$2b$10$legacy-bcrypt-hash')).toBe(true);
  });

  it('limits concurrent hashes and answers SERVICE_BUSY instead of exhausting memory', async () => {
    const saturated = new Argon2PasswordHasher({ maxConcurrent: 1, maxWaitMs: 1 });

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => saturated.hash(password('Tr0ca-de-Senha'))),
    );

    expect(results.filter((result) => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(
      1,
    );
    const busy = results.filter((result) => result.status === 'rejected');
    expect(busy.length).toBeGreaterThanOrEqual(1);
    for (const result of busy) {
      expect(result.status === 'rejected' && result.reason).toBeInstanceOf(ServiceBusyError);
    }
  });
});
