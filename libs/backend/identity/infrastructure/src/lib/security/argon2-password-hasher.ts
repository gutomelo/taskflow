import { argon2id, hash, needsRehash, verify } from 'argon2';
import type { Password, PasswordHasher } from '@taskflow/backend/identity/domain';
import { ConcurrencyLimiter } from './concurrency-limiter';

/** Parâmetros mínimos recomendados pela OWASP para Argon2id (RNF-01). */
export const ARGON2_PARAMETERS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export interface Argon2PasswordHasherOptions {
  /** Hashes simultâneos por processo (`PASSWORD_HASH_CONCURRENCY`). */
  readonly maxConcurrent: number;
  /** Espera máxima por uma vaga antes de responder `SERVICE_BUSY`. */
  readonly maxWaitMs?: number;
  /** Sobrescreve parâmetros apenas em testes (nunca reduza em produção). */
  readonly parameters?: typeof ARGON2_PARAMETERS;
}

export class Argon2PasswordHasher implements PasswordHasher {
  private readonly limiter: ConcurrencyLimiter;
  private readonly parameters: typeof ARGON2_PARAMETERS;

  constructor(options: Argon2PasswordHasherOptions) {
    this.limiter = new ConcurrencyLimiter(
      'password-hasher',
      options.maxConcurrent,
      options.maxWaitMs ?? 2_000,
    );
    this.parameters = options.parameters ?? ARGON2_PARAMETERS;
  }

  hash(password: Password): Promise<string> {
    return this.limiter.run(() => hash(password.reveal(), { type: argon2id, ...this.parameters }));
  }

  verify(passwordHash: string, candidate: string): Promise<boolean> {
    // Mesma normalização usada no cadastro (BR-011): a senha digitada em outro teclado confere.
    const normalized = candidate.normalize('NFC');
    return this.limiter.run(async () => {
      try {
        return await verify(passwordHash, normalized);
      } catch {
        // Hash malformado/desconhecido: tratado como senha incorreta, nunca como erro 500.
        return false;
      }
    });
  }

  needsRehash(passwordHash: string): boolean {
    if (!passwordHash.startsWith('$argon2id$')) return true;
    try {
      return needsRehash(passwordHash, this.parameters);
    } catch {
      return true;
    }
  }
}
