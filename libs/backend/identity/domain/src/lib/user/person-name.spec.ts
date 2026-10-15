import { InvalidPersonNameError, PersonName } from './person-name';

describe('PersonName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(PersonName.create('  Ana   Maria\tSouza ').value).toBe('Ana Maria Souza');
  });

  it('accepts accented names and up to 100 characters', () => {
    expect(PersonName.create('José Ângelo').value).toBe('José Ângelo');
    expect(() => PersonName.create('á'.repeat(100))).not.toThrow();
  });

  it.each([
    ['empty', ''],
    ['only whitespace', '   '],
    ['over 100 characters', 'a'.repeat(101)],
    ['control characters', 'Ana\u0000Souza'],
    ['invisible format characters', 'Ana‮Souza'],
  ])('rejects %s', (_case, raw) => {
    expect(() => PersonName.create(raw)).toThrow(InvalidPersonNameError);
  });
});
