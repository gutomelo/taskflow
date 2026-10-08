/**
 * Lista de senhas comuns/vazadas (BR-011). Porta do domínio: a implementação carrega
 * uma lista embarcada em memória na infraestrutura. Comparação case-insensitive.
 */
export interface CommonPasswordList {
  contains(password: string): boolean;
}
