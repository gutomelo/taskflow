import { isValidProjectKey, normalizeTypedKey, suggestProjectKey } from './project-key';

describe('project key (BR-025)', () => {
  it.each([
    ['Website', 'WEB'],
    ['Portal do Cliente', 'PDC'],
    ['Ação Rápida', 'AR'],
    ['2025 Planejamento', 'PLA'],
    ['App 2', 'A2'],
    ['', ''],
  ])('suggests %j → %j', (name, key) => {
    expect(suggestProjectKey(name)).toBe(key);
  });

  it('turns what is typed into uppercase letters and digits, up to 10', () => {
    expect(normalizeTypedKey('wéb-1 x')).toBe('WEB1X');
    expect(normalizeTypedKey('abcdefghijklmn')).toBe('ABCDEFGHIJ');
  });

  it('validates the format the API enforces', () => {
    expect(isValidProjectKey('WEB')).toBe(true);
    expect(isValidProjectKey('W')).toBe(false);
    expect(isValidProjectKey('1AB')).toBe(false);
    expect(isValidProjectKey('web')).toBe(false);
  });
});
