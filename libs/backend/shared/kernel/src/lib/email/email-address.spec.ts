import { DomainError } from '../errors/domain-error';
import { EmailAddress, InvalidEmailAddressError } from './email-address';

describe('EmailAddress', () => {
  it('normalizes surrounding whitespace and letter case', () => {
    expect(EmailAddress.create('  Ana.Souza@Exemplo.COM ').value).toBe('ana.souza@exemplo.com');
  });

  it('rejects internationalized addresses, which are not supported in the MVP', () => {
    expect(() => EmailAddress.create('jos\u00e9@exemplo.com')).toThrow(InvalidEmailAddressError);
    expect(() => EmailAddress.create('ana@exempl\u00f6.com')).toThrow(InvalidEmailAddressError);
  });

  it('renders as the normalized address', () => {
    expect(`${EmailAddress.create(' Ana@Exemplo.com')}`).toBe('ana@exemplo.com');
  });

  it('treats addresses differing only by case as the same account', () => {
    expect(EmailAddress.create('Joao@X.com').equals(EmailAddress.create('joao@x.com'))).toBe(true);
  });

  it.each([
    'ana+tag@exemplo.com',
    'a@b.co',
    "o'neil@sub.dominio.com.br",
    `${'a'.repeat(64)}@exemplo.com`,
  ])('accepts %s', (address) => {
    expect(() => EmailAddress.create(address)).not.toThrow();
  });

  it.each([
    ['empty', ''],
    ['missing at sign', 'ana.exemplo.com'],
    ['missing domain', 'ana@'],
    ['domain without TLD', 'ana@localhost'],
    ['two at signs', 'ana@@exemplo.com'],
    ['space inside', 'ana souza@exemplo.com'],
    ['leading dot', '.ana@exemplo.com'],
    ['consecutive dots', 'ana..souza@exemplo.com'],
    ['local part over 64 chars', `${'a'.repeat(65)}@exemplo.com`],
    [
      'over 254 chars',
      `ana@${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(70)}.com`,
    ],
    ['domain starting with hyphen', 'ana@-exemplo.com'],
  ])('rejects %s', (_case, address) => {
    expect(() => EmailAddress.create(address)).toThrow(InvalidEmailAddressError);
  });

  it('exposes a stable error code and never includes the rejected value', () => {
    let captured: unknown;
    try {
      EmailAddress.create('dado-pessoal@@exemplo');
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(DomainError);
    expect(captured).toMatchObject({
      code: 'INVALID_EMAIL_ADDRESS',
      name: 'InvalidEmailAddressError',
    });
    expect(String(captured)).not.toContain('dado-pessoal');
  });
});
