import { InvalidCommentBodyError, TooManyMentionsError } from '../errors';

export const COMMENT_BODY_MAX_LENGTH = 5000;
export const MAX_MENTIONS_PER_COMMENT = 20;

/**
 * Token de menção no texto: `<@uuid>`. A mesma gramática está em `libs/contracts` (o domínio não a
 * importa); a camada HTTP tem o teste de paridade.
 */
export const MENTION_TOKEN =
  /<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

/** Surrogate sem par: o PostgreSQL o trocaria por U+FFFD e o texto guardado divergiria. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Controles C0/C1 exceto tabulação e quebra de linha (`\p{Cc}` sem os dois). */
const CONTROL = /(?![\n\t])\p{Cc}/u;
/** Formatação bidi (embeddings, overrides, isolates): spoofing de link e de autoria (M2). */
const BIDI_FORMATTING = /[\u202A-\u202E\u2066-\u2069]/;
/** Pilhas de marcas combinantes ("Zalgo") cobririam a conversa. */
const COMBINING_STACK = /\p{M}{4,}/u;

/**
 * Texto validado de um comentário (BR-031) e as pessoas que ele menciona (BR-032), já sem o autor
 * e sem repetição, na ordem da primeira aparição. Só existe por `parseCommentBody`.
 */
export class CommentContent {
  private constructor(
    readonly body: string,
    readonly mentionedUserIds: ReadonlyArray<string>,
  ) {}

  /**
   * BR-031/BR-032, validação de entrada (antes de qualquer lock): Unicode bem formado, NFC, fins de
   * linha `\n`, bordas aparadas, 1–5 000 code points, sem controle (exceto `\n` e `\t`), sem
   * formatação bidi, sem pilhas de marcas combinantes. Tokens `<@uuid>` são reescritos em
   * minúsculas; menção ao próprio autor fica no texto mas não conta; até 20 pessoas distintas.
   */
  static parse(raw: string, authorUserId: string): CommentContent {
    if (LONE_SURROGATE.test(raw)) throw new InvalidCommentBodyError();
    const normalized = raw
      .normalize('NFC')
      .replace(/\r\n|\r/gu, '\n')
      .trim();
    const length = [...normalized].length;
    if (
      length === 0 ||
      length > COMMENT_BODY_MAX_LENGTH ||
      CONTROL.test(normalized) ||
      BIDI_FORMATTING.test(normalized) ||
      COMBINING_STACK.test(normalized)
    ) {
      throw new InvalidCommentBodyError();
    }
    const author = authorUserId.toLowerCase();
    const mentioned = new Set<string>();
    const body = normalized.replace(MENTION_TOKEN, (_token, id: string) => {
      const canonical = id.toLowerCase();
      if (canonical !== author) mentioned.add(canonical);
      return `<@${canonical}>`;
    });
    if (mentioned.size > MAX_MENTIONS_PER_COMMENT) throw new TooManyMentionsError();
    return new CommentContent(body, [...mentioned]);
  }
}

export function parseCommentBody(raw: string, authorUserId: string): CommentContent {
  return CommentContent.parse(raw, authorUserId);
}
