import { normalizeDisplayText } from './display-text';

const limits = { minLength: 2, maxLength: 10 };

describe('normalizeDisplayText', () => {
  it('normalizes to NFC, trims and collapses whitespace, including line breaks', () => {
    expect(normalizeDisplayText('  Ana\r\n  Souza\t ', { minLength: 1, maxLength: 20 })).toBe(
      'Ana Souza',
    );
    expect(normalizeDisplayText(`Jose${String.fromCodePoint(0x301)}`, limits)).toBe('José');
  });

  it('counts code points against the limits', () => {
    expect(normalizeDisplayText('😀😀', limits)).toBe('😀😀');
    expect(normalizeDisplayText('a', limits)).toBeNull();
    expect(normalizeDisplayText('a'.repeat(11), limits)).toBeNull();
  });

  it('turns a byte order mark into an ordinary visible space (JavaScript treats it as whitespace)', () => {
    const bom = String.fromCodePoint(0xfeff);
    expect(normalizeDisplayText(`${bom}Ac${bom}me`, { minLength: 1, maxLength: 40 })).toBe('Ac me');
  });

  // Códigos explícitos: caracteres invisíveis literais no código seriam ilegíveis em revisão.
  const char = (codePoint: number) => String.fromCodePoint(codePoint);
  const lone = (code: number) => String.fromCharCode(code);
  it.each([
    ['NUL control', `Acme${char(0x00)}x`],
    ['bidi override (RLO)', `Acme${char(0x202e)}txt.exe`],
    ['bidi isolate', `Acme${char(0x2066)}x`],
    ['zero-width space', `Ac${char(0x200b)}me`],
    ['zero-width joiner', `Ac${char(0x200d)}me`],
    ['private use', `Acme${char(0xe000)}`],
    ['lone surrogate', `Acme${lone(0xd800)}`],
  ])('rejects %s', (_case, value) => {
    expect(normalizeDisplayText(value, { minLength: 1, maxLength: 40 })).toBeNull();
  });
});
