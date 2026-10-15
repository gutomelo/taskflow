import { CryptoSecretTokenGenerator } from './crypto-secret-token-generator';

describe('CryptoSecretTokenGenerator', () => {
  const generator = new CryptoSecretTokenGenerator();

  it('RNF-02: generates 256-bit URL-safe tokens and a 64-char SHA-256 hex hash', () => {
    const { token, tokenHash } = generator.generate();

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(generator.hash(token)).toBe(tokenHash);
  });

  it('never repeats tokens', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generator.generate().token));

    expect(tokens.size).toBe(1000);
  });
});
