import { parseCookie } from 'cookie';
import type { Request } from 'express';

/** Lê um cookie da requisição sem depender de middleware global de parsing. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  return parseCookie(header)[name];
}
