import { InvalidCommentBodyError, TooManyMentionsError } from '../errors';
import {
  COMMENT_BODY_MAX_LENGTH,
  MAX_MENTIONS_PER_COMMENT,
  parseCommentBody,
} from './comment-content';

const ANA = '0192a000-0000-7000-8000-00000000a0a0';
const BIA = '0192a000-0000-7000-8000-00000000b1b1';
const VIVI = '0192a000-0000-7000-8000-00000000c2c2';
const uuid = (n: number) => `0192a000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

const invalid = (raw: string) =>
  expect(() => parseCommentBody(raw, ANA)).toThrow(InvalidCommentBodyError);

describe('BR-031: comment body', () => {
  it('keeps line breaks and inner spacing, normalizes line endings and trims the edges', () => {
    expect(parseCommentBody('  Pode revisar?\r\n\r\n  Obrigado\t!\r ', ANA).body).toBe(
      'Pode revisar?\n\n  Obrigado\t!',
    );
  });

  it('normalizes to NFC', () => {
    expect(parseCommentBody('Cafe\u0301', ANA).body).toBe('Caf\u00e9');
  });

  it('refuses empty or blank text', () => {
    for (const raw of ['', '   ', '\n\n\t\r\n']) invalid(raw);
  });

  it('counts code points up to the limit', () => {
    expect(parseCommentBody('😀'.repeat(COMMENT_BODY_MAX_LENGTH), ANA).body).toHaveLength(
      COMMENT_BODY_MAX_LENGTH * 2,
    );
    invalid('a'.repeat(COMMENT_BODY_MAX_LENGTH + 1));
  });

  it('refuses control characters other than line break and tab', () => {
    for (const raw of ['a\u0000b', 'a\u0007b', 'a\u001Bb', 'a\u007Fb', 'a\u0085b', 'a\u000Bb']) {
      invalid(raw);
    }
  });

  it('M2: refuses bidi formatting (overrides, embeddings, isolates)', () => {
    for (const code of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      invalid(`https://evil.example/${String.fromCodePoint(code)}moc.knab`);
    }
  });

  it('accepts emoji sequences with zero-width joiners and right-to-left text', () => {
    expect(parseCommentBody('👩‍💻 שלום مرحبا', ANA).body).toBe('👩‍💻 שלום مرحبا');
  });

  it('B6: refuses lone surrogates and stacks of combining marks', () => {
    invalid('a\uD800b');
    invalid('a\uDC00b');
    invalid('x' + '\u0301\u0302\u0303\u0304');
    expect(parseCommentBody('x' + '\u0301\u0302\u0303', ANA).body).toBe('x\u0301\u0302\u0303');
  });
});

describe('BR-032: mentions in the body', () => {
  it('extracts distinct people in order of first appearance, without the author', () => {
    const content = parseCommentBody(
      `<@${BIA}> e <@${VIVI}>, cc <@${BIA}> — eu sou <@${ANA}>`,
      ANA,
    );
    expect(content.mentionedUserIds).toEqual([BIA, VIVI]);
    expect(content.body).toContain(`<@${ANA}>`);
  });

  it('rewrites tokens in canonical lower case (the same mention)', () => {
    const content = parseCommentBody(`<@${BIA.toUpperCase()}> <@${BIA}>`, ANA);
    expect(content.body).toBe(`<@${BIA}> <@${BIA}>`);
    expect(content.mentionedUserIds).toEqual([BIA]);
  });

  it('the author mentioned in upper case is still the author', () => {
    expect(parseCommentBody(`<@${ANA.toUpperCase()}>`, ANA).mentionedUserIds).toEqual([]);
    expect(parseCommentBody(`<@${ANA}>`, ANA.toUpperCase()).mentionedUserIds).toEqual([]);
  });

  it('malformed tokens are plain text', () => {
    const raw = `<@${BIA.slice(0, -1)}> <@ ${BIA}> @${BIA} <@${BIA}x>`;
    const content = parseCommentBody(raw, ANA);
    expect(content.mentionedUserIds).toEqual([]);
    expect(content.body).toBe(raw);
  });

  it('allows up to 20 distinct people and refuses more', () => {
    const tokens = (count: number) =>
      Array.from({ length: count }, (_, index) => `<@${uuid(index + 1)}>`).join(' ');
    expect(parseCommentBody(tokens(MAX_MENTIONS_PER_COMMENT), ANA).mentionedUserIds).toHaveLength(
      MAX_MENTIONS_PER_COMMENT,
    );
    expect(() => parseCommentBody(tokens(MAX_MENTIONS_PER_COMMENT + 1), ANA)).toThrow(
      TooManyMentionsError,
    );
    // Repetições não contam.
    expect(() =>
      parseCommentBody(`${tokens(MAX_MENTIONS_PER_COMMENT)} <@${uuid(1)}> <@${ANA}>`, ANA),
    ).not.toThrow();
  });
});
