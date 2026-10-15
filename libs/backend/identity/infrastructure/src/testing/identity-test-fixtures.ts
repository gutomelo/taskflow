import { createHash, randomUUID } from 'node:crypto';
import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { PersonName, Session, User, type SessionClient } from '@taskflow/backend/identity/domain';

/** Hash SHA-256 hex (CHAR(64)), como os tokens reais. */
export const tokenHash = (seed: string = randomUUID()) =>
  createHash('sha256').update(seed).digest('hex');

export const newToken = () => ({ id: randomUUID(), tokenHash: tokenHash() });

export const browser: SessionClient = { ipPrefix: '203.0.113.0/24', userAgent: 'Firefox/140' };

export function buildUser(email = `user-${randomUUID()}@exemplo.com`, now = new Date()): User {
  return User.register({
    id: randomUUID(),
    email: EmailAddress.create(email),
    name: PersonName.create('Ana Souza'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture',
    now,
  });
}

export function buildSession(userId: string, now = new Date(), client = browser): Session {
  return Session.start({ id: randomUUID(), userId, token: newToken(), client, now });
}
