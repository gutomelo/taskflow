const FALLBACK = '/';
const MAX_LENGTH = 2_048;
// Origem fictícia só para o parser: qualquer valor que resolva para outra origem é externo.
const PARSE_BASE = 'https://taskflow.invalid';

/** Páginas de visitante: voltar a elas após o login criaria um laço. */
const GUEST_ONLY_PATHS = new Set(['/login', '/register', '/forgot-password', '/reset-password']);

/**
 * Normaliza o `returnUrl` para um caminho interno seguro (contra open redirect). Rejeita
 * URLs absolutas, protocolo-relativas (`//`), barras invertidas e caracteres de controle.
 * O fragmento é sempre descartado: ele pode conter tokens de e-mail (`#token=…`) que não
 * podem migrar para a query string, onde iriam para logs e histórico.
 */
export function safeReturnUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return FALLBACK;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return FALLBACK;
  if ([...raw].some(isControlCharacter)) return FALLBACK;

  let url: URL;
  try {
    url = new URL(raw, PARSE_BASE);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== PARSE_BASE || GUEST_ONLY_PATHS.has(url.pathname)) return FALLBACK;
  return `${url.pathname}${url.search}`;
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}
