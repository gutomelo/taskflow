/**
 * Caracteres que não podem aparecer em texto exibido a outras pessoas (nomes em telas e
 * e-mails): controles (Cc), formatação invisível — bidi, zero-width, BOM (Cf), uso privado (Co),
 * não atribuídos (Cn) e surrogates soltos (Cs). Bloqueiam truques de exibição e phishing.
 */
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}]/u;

/**
 * Normaliza texto exibível (NFC, bordas aparadas, espaços internos — inclusive quebras de
 * linha — reduzidos a um) e valida o tamanho em code points. `null` se inválido.
 */
export function normalizeDisplayText(
  raw: string,
  { minLength, maxLength }: { readonly minLength: number; readonly maxLength: number },
): string | null {
  const normalized = raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const length = [...normalized].length;
  if (length < minLength || length > maxLength || FORBIDDEN.test(normalized)) return null;
  return normalized;
}
