import { createHash } from 'node:crypto';
import { HmacPseudonymizer } from './hmac-pseudonymizer';

describe('HmacPseudonymizer', () => {
  const pseudonymizer = new HmacPseudonymizer('k'.repeat(43));

  it('is deterministic for the same key and value', () => {
    expect(pseudonymizer.pseudonymize('ana@exemplo.com')).toBe(
      pseudonymizer.pseudonymize('ana@exemplo.com'),
    );
  });

  it('never contains the original value and differs from a plain (dictionary-reversible) hash', () => {
    const pseudonym = pseudonymizer.pseudonymize('ana@exemplo.com');

    expect(pseudonym).not.toContain('ana');
    expect(pseudonym).not.toBe(createHash('sha256').update('ana@exemplo.com').digest('base64url'));
  });

  it('depends on the key', () => {
    expect(new HmacPseudonymizer('x'.repeat(43)).pseudonymize('ana@exemplo.com')).not.toBe(
      pseudonymizer.pseudonymize('ana@exemplo.com'),
    );
  });
});
