/**
 * Pseudonimização determinística (HMAC com chave) de identificadores pessoais — e-mail em
 * chaves de rate limit e logs. Sem a chave, o valor original não é recuperável por dicionário.
 */
export interface Pseudonymizer {
  pseudonymize(value: string): string;
}
