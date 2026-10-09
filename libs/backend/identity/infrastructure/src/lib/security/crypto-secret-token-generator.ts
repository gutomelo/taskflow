import { createHash, randomBytes } from 'node:crypto';
import type { GeneratedSecret, SecretTokenGenerator } from '@taskflow/backend/identity/domain';

/** 32 bytes aleatórios (256 bits) em base64url; persistido somente como SHA-256 hex (RNF-02). */
export class CryptoSecretTokenGenerator implements SecretTokenGenerator {
  generate(): GeneratedSecret {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
