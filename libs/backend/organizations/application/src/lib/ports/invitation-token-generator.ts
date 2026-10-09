/**
 * Porta para o token do convite (RNF-02: ≥ 256 bits, persistido só como SHA-256 hex). O worker
 * gera; a API só calcula o hash do token apresentado. Ligada no composition root ao gerador
 * criptográfico já usado por `identity`.
 */
export interface InvitationTokenGenerator {
  generate(): Readonly<{ token: string; tokenHash: string }>;
  hash(token: string): string;
}
