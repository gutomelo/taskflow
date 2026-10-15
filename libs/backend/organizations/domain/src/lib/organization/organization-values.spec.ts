import { InvalidOrganizationNameError, InvalidSlugError } from '../errors';
import { OrganizationName } from './organization-name';
import { OrganizationSlug } from './organization-slug';

describe('OrganizationSlug (BR-022)', () => {
  it.each(['acme', 'acme-labs', 'a1b', 'x'.repeat(40), 'q3-2026-team'])('accepts %s', (slug) => {
    expect(OrganizationSlug.create(slug).value).toBe(slug);
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'x'.repeat(41)],
    ['upper case', 'Acme'],
    ['starts with a digit', '1acme'],
    ['starts with a hyphen', '-acme'],
    ['ends with a hyphen', 'acme-'],
    ['double hyphen', 'a--b'],
    ['underscore', 'acme_labs'],
    ['accent', 'ação'],
    ['space', 'acme labs'],
  ])('BR-022: rejects a slug with %s', (_case, slug) => {
    expect(() => OrganizationSlug.create(slug)).toThrow(InvalidSlugError);
  });

  it.each(['admin', 'support', 'taskflow', 'security'])(
    'BR-022: rejects the reserved slug %s (impersonation)',
    (slug) => {
      expect(() => OrganizationSlug.create(slug)).toThrow(InvalidSlugError);
    },
  );
});

describe('OrganizationName', () => {
  it('normalizes whitespace and accepts 2–80 characters', () => {
    expect(OrganizationName.create('  Acme   Labs ').value).toBe('Acme Labs');
    expect(OrganizationName.create('x'.repeat(80)).value).toHaveLength(80);
  });

  it.each([
    ['too short', 'A'],
    ['too long', 'x'.repeat(81)],
    ['bidi override (phishing in e-mails)', `Acme${String.fromCodePoint(0x202e)}moc`],
    ['zero-width character', `Ac${String.fromCodePoint(0x200b)}me`],
  ])('rejects a name %s', (_case, name) => {
    expect(() => OrganizationName.create(name)).toThrow(InvalidOrganizationNameError);
  });
});
