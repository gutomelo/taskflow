/** Segredo gerado para o cliente (refresh token, link de e-mail) e o hash que é persistido. */
export type GeneratedSecret = Readonly<{
  /** Valor entregue ao cliente; nunca persistido nem registrado em log. */
  token: string;
  /** SHA-256 hex (64 caracteres) — único valor armazenado. */
  tokenHash: string;
}>;

/** Porta: segredos com ≥ 256 bits de entropia (RNF-02). Implementação com `node:crypto`. */
export interface SecretTokenGenerator {
  generate(): GeneratedSecret;
  /** Hash para localizar um token apresentado pelo cliente. */
  hash(token: string): string;
}
