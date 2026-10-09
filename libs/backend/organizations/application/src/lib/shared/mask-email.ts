/** `bia.souza@exemplo.com` ⇒ `b***@exemplo.com`: o convidado reconhece o endereço sem expô-lo. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
