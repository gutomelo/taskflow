import { inspect } from 'node:util';
import { EmailAddress } from '@taskflow/backend/shared/kernel';
import type { CommonPasswordList } from './common-password-list';
import { Password, PasswordPolicyViolationError, type PasswordRule } from './password';

const commonPasswords: CommonPasswordList = {
  contains: (password) => ['senha@123', 'password1!'].includes(password.toLowerCase()),
};
const context = { email: EmailAddress.create('ana@exemplo.com'), commonPasswords };

function violatedRules(raw: string): ReadonlyArray<PasswordRule> {
  try {
    Password.create(raw, context);
  } catch (error) {
    if (error instanceof PasswordPolicyViolationError) return error.violatedRules;
    throw error;
  }
  return [];
}

describe('Password (BR-011)', () => {
  it('BR-011: accepts a password meeting every rule', () => {
    expect(violatedRules('Tr0ca-de-Senha')).toEqual([]);
  });

  it.each<[string, string, PasswordRule]>([
    ['shorter than 8 characters', 'Ab1!xyz', 'min_length'],
    ['longer than 128 characters', `Ab1!${'x'.repeat(125)}`, 'max_length'],
    ['without an uppercase letter', 'tr0ca-de-senha', 'uppercase'],
    ['without a lowercase letter', 'TR0CA-DE-SENHA', 'lowercase'],
    ['without a digit', 'Troca-de-Senha', 'digit'],
    ['without a symbol', 'Tr0caDeSenha', 'symbol'],
  ])('BR-011: rejects a password %s', (_case, raw, rule) => {
    expect(violatedRules(raw)).toContain(rule);
  });

  it('BR-011: accepts exactly 8 and exactly 128 characters', () => {
    expect(violatedRules('Ab1!wxyz')).toEqual([]);
    expect(violatedRules(`Ab1!${'x'.repeat(124)}`)).toEqual([]);
  });

  it('BR-011: rejects a password equal to the email, ignoring case', () => {
    expect(violatedRules('Ana@Exemplo.Com')).toContain('same_as_email');
    expect(violatedRules('Ana@Exemplo.com1')).not.toContain('same_as_email');
  });

  it('BR-011: rejects passwords from the common/leaked list even when composition is valid', () => {
    expect(violatedRules('Senha@123')).toEqual(['common_password']);
  });

  it('BR-011: reports every violated rule at once', () => {
    expect(violatedRules('abc')).toEqual(['min_length', 'uppercase', 'digit', 'symbol']);
  });

  it('counts characters, not bytes, and never truncates', () => {
    const emojiPassword = `Ab1!${'😀'.repeat(124)}`; // 128 caracteres, 500+ bytes
    expect(violatedRules(emojiPassword)).toEqual([]);
    expect(Password.create(emojiPassword, context).reveal()).toBe(emojiPassword);
    expect(violatedRules(`${emojiPassword}😀`)).toContain('max_length');
  });

  it('normalizes to NFC so the same password typed on different keyboards matches', () => {
    const decomposed = Password.create('São-Paulo1', context);
    const composed = Password.create('São-Paulo1', context);

    expect(decomposed.reveal()).toBe(composed.reveal());
  });

  it('accepts Unicode letters and spaces (passphrases)', () => {
    expect(violatedRules('Ação diária 2026!')).toEqual([]);
  });

  it('never reveals the plain text through string conversion, JSON or inspection', () => {
    const password = Password.create('Tr0ca-de-Senha', context);

    expect(String(password)).not.toContain('Tr0ca');
    expect(JSON.stringify({ password })).not.toContain('Tr0ca');
    expect(inspect(password)).not.toContain('Tr0ca');
    expect(`${password}`).toBe('[REDACTED]');
  });

  it('exposes a stable error code without the password in the message', () => {
    const attempt = () => Password.create('segredo', context);

    expect(attempt).toThrow(PasswordPolicyViolationError);
    expect(attempt).toThrow(expect.objectContaining({ code: 'PASSWORD_POLICY_VIOLATION' }));
    expect(attempt).not.toThrow(/segredo/);
  });
});
