import { unmetPasswordRules } from './password-policy';

// Casos alinhados aos de `password.spec.ts` do domínio: o feedback não pode divergir do backend.
describe('unmetPasswordRules (mirror of BR-011)', () => {
  it('accepts a password that meets every rule', () => {
    expect(unmetPasswordRules('Correct-Horse-9', 'ana@exemplo.com')).toEqual([]);
  });

  it('lists every unmet rule at once', () => {
    expect(unmetPasswordRules('abc', 'ana@exemplo.com')).toEqual([
      'min_length',
      'uppercase',
      'digit',
      'symbol',
    ]);
  });

  it('counts characters (code points), not UTF-16 units', () => {
    // 7 emojis = 14 unidades UTF-16, mas só 7 caracteres.
    expect(unmetPasswordRules('Aa1😀😀😀😀', 'x@y.z')).toContain('min_length');
    expect(unmetPasswordRules('Aa1😀😀😀😀😀', 'x@y.z')).not.toContain('min_length');
  });

  it('normalizes to NFC before counting, like the domain', () => {
    // "é" decomposto (e + acento combinante) conta como um caractere após NFC.
    const decomposed = 'Aééé!1';
    expect([...decomposed].length).toBe(9);
    expect(unmetPasswordRules(decomposed, 'x@y.z')).toContain('min_length');
  });

  it('enforces the maximum of 128 characters', () => {
    expect(unmetPasswordRules(`Aa1!${'x'.repeat(124)}`, 'x@y.z')).toEqual([]);
    expect(unmetPasswordRules(`Aa1!${'x'.repeat(125)}`, 'x@y.z')).toEqual(['max_length']);
  });

  it('uses Unicode categories for letters and digits', () => {
    expect(unmetPasswordRules('ÇÃOÉ-ção-١٢', 'x@y.z')).toEqual([]);
  });

  it('treats any non-letter, non-number, non-space character as a symbol', () => {
    expect(unmetPasswordRules('Senha forte 1', 'x@y.z')).toEqual(['symbol']);
    expect(unmetPasswordRules('Senha_forte_1', 'x@y.z')).toEqual([]);
  });

  it('rejects the e-mail itself, ignoring case', () => {
    expect(unmetPasswordRules('Ana@Exemplo.com1', 'ana@exemplo.com1')).toEqual(['same_as_email']);
    expect(unmetPasswordRules('Ana@Exemplo.com1', '')).toEqual([]);
  });
});
