import { isValidSlug, suggestSlug } from './slug';

describe('slug (BR-022)', () => {
  it.each([
    ['Acme Ltda', 'acme-ltda'],
    ['  Café & Cia — São Paulo ', 'cafe-cia-sao-paulo'],
    ['123 Tecnologia', 'tecnologia'],
    ['Ação!!!', 'acao'],
    ['x'.repeat(60), 'x'.repeat(40)],
    ['a-'.repeat(30), 'a-'.repeat(19) + 'a'],
  ])('suggests %j as %j', (name, slug) => {
    expect(suggestSlug(name)).toBe(slug);
  });

  it.each(['acme', 'acme-ltda', 'a1b', 'abc-123'])('accepts %s', (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each(['ab', '1acme', 'Acme', 'acme-', 'ac--me', 'acme_ltda', 'x'.repeat(41)])(
    'rejects %s',
    (slug) => {
      expect(isValidSlug(slug)).toBe(false);
    },
  );
});
