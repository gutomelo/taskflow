import type { CommentPerson } from '@taskflow/contracts';

/**
 * Pedaços de um comentário para exibição (RNF-02): nunca HTML. Menções viram o nome atual (ou
 * "Ex-membro"), links só `http(s)` com host, quebras de linha explícitas; o resto é texto puro,
 * interpolado pelo Angular.
 */
export type CommentSegment =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'mention'; userId: string; name: string | null }>
  | Readonly<{ kind: 'link'; href: string; label: string }>
  | Readonly<{ kind: 'newline' }>;

/**
 * Gramática do token (espelho de `MENTION_TOKEN_PATTERN` dos contratos; teste de paridade) e
 * candidato a link: termina antes de espaço, `<`, `>` e de qualquer caractere de formatação
 * (`\p{Cf}`: bidi, zero-width) — o texto exibido não pode diferir do destino (M2 da segurança).
 */
export const MENTION_TOKEN_SOURCE =
  '<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>';
const PIECES = new RegExp(`${MENTION_TOKEN_SOURCE}|https?:\\/\\/[^\\s<>\\p{Cf}]+`, 'gu');
const TRAILING_PUNCTUATION = /[.,;:!?)\]'"]+$/u;

/** Link seguro ou `null`: só `http(s)`, com host; o rótulo é a forma normalizada pelo `URL`. */
function safeLink(candidate: string): Readonly<{ href: string; label: string }> | null {
  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') return null;
    return { href: url.href, label: url.href };
  } catch {
    return null;
  }
}

function segmentLine(line: string, names: ReadonlyMap<string, string | null>): CommentSegment[] {
  const segments: CommentSegment[] = [];
  let text = '';
  let last = 0;
  const flush = () => {
    if (text !== '') segments.push({ kind: 'text', text });
    text = '';
  };
  for (const match of line.matchAll(PIECES)) {
    text += line.slice(last, match.index);
    last = match.index + match[0].length;
    const userId = match[1]?.toLowerCase();
    if (userId !== undefined) {
      // Token sem menção correspondente (ex.: mencionado sem acesso) fica como texto.
      if (!names.has(userId)) {
        text += match[0];
        continue;
      }
      flush();
      segments.push({ kind: 'mention', userId, name: names.get(userId) ?? null });
      continue;
    }
    const trailing = TRAILING_PUNCTUATION.exec(match[0])?.[0] ?? '';
    const candidate = match[0].slice(0, match[0].length - trailing.length);
    const link = safeLink(candidate);
    if (!link) {
      text += match[0];
      continue;
    }
    flush();
    segments.push({ kind: 'link', ...link });
    text += trailing;
  }
  text += line.slice(last);
  flush();
  return segments;
}

export function commentSegments(
  body: string,
  mentions: ReadonlyArray<CommentPerson>,
): CommentSegment[] {
  const names = new Map(mentions.map((mention) => [mention.userId.toLowerCase(), mention.name]));
  return body
    .split('\n')
    .flatMap((line, index) => [
      ...(index > 0 ? [{ kind: 'newline' } as const] : []),
      ...segmentLine(line, names),
    ]);
}

/** Data relativa em pt-BR ("há 5 minutos"), com a absoluta para o `title`. */
export function relativeTime(iso: string, now: Date): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  const steps: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return format.format(value, unit);
    value = Math.round(value / size);
  }
  return format.format(value, 'year');
}

export function absoluteTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
