import { safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it.each([
    ['/account/security', '/account/security'],
    ['/projects/42?tab=board', '/projects/42?tab=board'],
    ['/a/../account', '/account'],
  ])('keeps the internal path %s', (raw, expected) => {
    expect(safeReturnUrl(raw)).toBe(expected);
  });

  it.each([
    ['absolute URL', 'https://evil.example/phish'],
    ['protocol-relative URL', '//evil.example'],
    ['backslash trick', '/\\evil.example'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['relative path', 'account'],
    ['control character', '/account\n/x'],
    ['tab character', '/\t/evil.example'],
    ['empty', ''],
    ['too long', `/${'a'.repeat(2_048)}`],
    ['not a string', ['/account']],
    ['missing', null],
  ])('falls back to the home page for %s', (_case, raw) => {
    expect(safeReturnUrl(raw)).toBe('/');
  });

  it.each(['/login', '/register?x=1', '/forgot-password', '/reset-password'])(
    'never returns to the guest-only page %s (would loop after login)',
    (raw) => {
      expect(safeReturnUrl(raw)).toBe('/');
    },
  );

  it('drops the fragment so e-mail tokens never move into the query string', () => {
    expect(safeReturnUrl('/verify-email#token=secret-token')).toBe('/verify-email');
  });
});
