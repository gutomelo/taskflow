import type { CommentPerson } from '@taskflow/contracts';
import { MENTION_TOKEN_SOURCE } from './comment-body';

/**
 * Texto do composer com menções (I7 da revisão de arquitetura): o `textarea` mostra `@Nome`; os
 * intervalos `{ start, end, userId }` dizem onde estão as menções e se ajustam a cada edição. Mexer
 * **dentro** de um intervalo o desfaz (vira texto comum). Ao enviar, `serialize` troca cada
 * intervalo por `<@id>`; na edição, `deserialize` faz o caminho inverso com as menções da API.
 */
export type MentionRange = Readonly<{ start: number; end: number; userId: string }>;
export type MentionDraft = Readonly<{ text: string; ranges: ReadonlyArray<MentionRange> }>;

export const EMPTY_DRAFT: MentionDraft = { text: '', ranges: [] };
export const FORMER_MEMBER_LABEL = 'Ex-membro';

/** Aplica um novo texto (vindo do `input`) pela diferença mínima com o anterior. */
export function applyEdit(draft: MentionDraft, text: string): MentionDraft {
  const before = draft.text;
  let prefix = 0;
  while (prefix < before.length && prefix < text.length && before[prefix] === text[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < text.length - prefix &&
    before[before.length - 1 - suffix] === text[text.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const changedEnd = before.length - suffix;
  const delta = text.length - before.length;
  const ranges = draft.ranges.flatMap((range) => {
    if (range.end <= prefix) return [range];
    if (range.start >= changedEnd) {
      return [{ ...range, start: range.start + delta, end: range.end + delta }];
    }
    return [];
  });
  return { text, ranges };
}

/** Troca o trecho `[from, to)` (o `@consulta`) pela menção e um espaço; devolve o novo cursor. */
export function insertMention(
  draft: MentionDraft,
  from: number,
  to: number,
  person: Readonly<{ userId: string; name: string }>,
): Readonly<{ draft: MentionDraft; caret: number }> {
  const label = `@${person.name}`;
  const text = `${draft.text.slice(0, from)}${label} ${draft.text.slice(to)}`;
  const delta = label.length + 1 - (to - from);
  const ranges = [
    ...draft.ranges.flatMap((range) => {
      if (range.end <= from) return [range];
      if (range.start >= to)
        return [{ ...range, start: range.start + delta, end: range.end + delta }];
      return [];
    }),
    { start: from, end: from + label.length, userId: person.userId },
  ].sort((a, b) => a.start - b.start);
  return { draft: { text, ranges }, caret: from + label.length + 1 };
}

/** Texto para a API: cada intervalo vira `<@id>`. */
export function serialize(draft: MentionDraft): string {
  let body = '';
  let last = 0;
  for (const range of [...draft.ranges].sort((a, b) => a.start - b.start)) {
    body += `${draft.text.slice(last, range.start)}<@${range.userId}>`;
    last = range.end;
  }
  return body + draft.text.slice(last);
}

/** Tamanho que a API vai contar (code points do texto serializado). */
export function serializedLength(draft: MentionDraft): number {
  return [...serialize(draft)].length;
}

/** Texto da API para o composer: tokens com menção viram `@Nome` (ou `@Ex-membro`). */
export function deserialize(body: string, mentions: ReadonlyArray<CommentPerson>): MentionDraft {
  const names = new Map(mentions.map((mention) => [mention.userId.toLowerCase(), mention.name]));
  const ranges: MentionRange[] = [];
  let text = '';
  let last = 0;
  for (const match of body.matchAll(new RegExp(MENTION_TOKEN_SOURCE, 'g'))) {
    const userId = match[1]?.toLowerCase() ?? '';
    text += body.slice(last, match.index);
    last = match.index + match[0].length;
    if (!names.has(userId)) {
      text += match[0];
      continue;
    }
    const label = `@${names.get(userId) ?? FORMER_MEMBER_LABEL}`;
    ranges.push({ start: text.length, end: text.length + label.length, userId });
    text += label;
  }
  return { text: text + body.slice(last), ranges };
}

/**
 * Consulta de menção em digitação: `@` no início ou depois de espaço, seguido de 1 a 50 caracteres
 * sem espaço até o cursor, fora de uma menção já feita.
 */
export function activeQuery(
  draft: MentionDraft,
  caret: number,
): Readonly<{ start: number; query: string }> | null {
  const match = /(^|\s)@([^\s@]{1,50})$/u.exec(draft.text.slice(0, caret));
  if (!match) return null;
  const start = caret - (match[2]?.length ?? 0) - 1;
  if (draft.ranges.some((range) => start < range.end && caret > range.start)) return null;
  return { start, query: match[2] ?? '' };
}
