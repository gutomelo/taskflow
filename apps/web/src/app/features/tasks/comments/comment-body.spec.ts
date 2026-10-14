import { MENTION_TOKEN_PATTERN } from '@taskflow/contracts';
import { commentSegments, MENTION_TOKEN_SOURCE, relativeTime } from './comment-body';

const MIA = '0192a000-0000-7000-8000-00000000a1a1';
const GONE = '0192a000-0000-7000-8000-00000000c1c1';
const UNKNOWN = '0192a000-0000-7000-8000-00000000d1d1';
const mentions = [
  { userId: MIA, name: 'Mia' },
  { userId: GONE, name: null },
];
const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);

describe('comment segments (RNF-02, B2 of the security review)', () => {
  it('keeps the token grammar identical to the contracts', () => {
    expect(MENTION_TOKEN_SOURCE).toBe(MENTION_TOKEN_PATTERN.source);
  });

  it('splits text, line breaks and mentions by current name; ex-members have no name', () => {
    expect(commentSegments(`Oi <@${MIA}>,\nveja <@${GONE}>`, mentions)).toEqual([
      { kind: 'text', text: 'Oi ' },
      { kind: 'mention', userId: MIA, name: 'Mia' },
      { kind: 'text', text: ',' },
      { kind: 'newline' },
      { kind: 'text', text: 'veja ' },
      { kind: 'mention', userId: GONE, name: null },
    ]);
  });

  it('every mention of the comment appears as a mention segment; unknown tokens stay text', () => {
    const segments = commentSegments(`<@${MIA.toUpperCase()}> <@${UNKNOWN}> <@${GONE}>`, mentions);
    expect(
      segments
        .filter((segment) => segment.kind === 'mention')
        .map((segment) => segment.kind === 'mention' && segment.userId),
    ).toEqual([MIA, GONE]);
    expect(segments).toContainEqual({ kind: 'text', text: ` <@${UNKNOWN}> ` });
  });

  it('links only http(s) with a host, without trailing punctuation', () => {
    expect(commentSegments('Veja https://exemplo.com/a?b=1. ok', [])).toEqual([
      { kind: 'text', text: 'Veja ' },
      { kind: 'link', href: 'https://exemplo.com/a?b=1', label: 'https://exemplo.com/a?b=1' },
      { kind: 'text', text: '. ok' },
    ]);
    for (const raw of [
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'ftp://x.com',
      'https://',
    ]) {
      expect(
        commentSegments(raw, []).some((segment) => segment.kind === 'link'),
        raw,
      ).toBe(false);
    }
  });

  it('XSS payloads stay plain text', () => {
    for (const raw of [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '"><svg onload=alert(1)>',
    ]) {
      expect(commentSegments(raw, [])).toEqual([{ kind: 'text', text: raw }]);
    }
  });

  it('M2: a link stops at formatting characters and at "<", so a mention inside it still shows', () => {
    const spoof = commentSegments(`https://evil.example/${RLO}moc.knab`, []);
    expect(spoof[0]).toEqual({
      kind: 'link',
      href: 'https://evil.example/',
      label: 'https://evil.example/',
    });
    expect(commentSegments(`https://x.com/${ZWSP}y`, [])[0]).toMatchObject({
      href: 'https://x.com/',
    });
    const inside = commentSegments(`https://x.com/<@${MIA}>`, mentions);
    expect(inside).toEqual([
      { kind: 'link', href: 'https://x.com/', label: 'https://x.com/' },
      { kind: 'mention', userId: MIA, name: 'Mia' },
    ]);
  });

  it('shows the normalized address (IDN in punycode)', () => {
    expect(commentSegments('https://exämple.com', [])[0]).toMatchObject({
      href: 'https://xn--exmple-cua.com/',
      label: 'https://xn--exmple-cua.com/',
    });
  });
});

describe('relative time', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  it('speaks pt-BR', () => {
    expect(relativeTime('2026-10-14T11:55:00.000Z', now)).toBe('há 5 minutos');
    expect(relativeTime('2026-10-13T12:00:00.000Z', now)).toBe('ontem');
    expect(relativeTime('2026-10-14T12:00:00.000Z', now)).toBe('agora');
  });
});
