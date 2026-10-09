import { DomainError, type EmailAddress } from '@taskflow/backend/shared/kernel';
import type { PersonName } from './person-name';

export class EmailAlreadyVerifiedError extends DomainError {
  readonly code = 'EMAIL_ALREADY_VERIFIED';

  constructor() {
    super('Email address is already verified');
  }
}

/** Estado persistido de um usuário (reidratação pelo repositório). */
export type UserSnapshot = Readonly<{
  id: string;
  email: EmailAddress;
  name: PersonName;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  passwordChangedAt: Date;
  createdAt: Date;
  version: number;
}>;

export interface RegisterUserInput {
  readonly id: string;
  readonly email: EmailAddress;
  readonly name: PersonName;
  readonly passwordHash: string;
  readonly now: Date;
}

/**
 * Agregado de identidade. Usuários são globais (não pertencem a uma organização — ADR 0004).
 * `version` é controlada pelo repositório (optimistic locking, ADR 0006).
 */
export class User {
  private constructor(private state: UserSnapshot) {}

  static register({ id, email, name, passwordHash, now }: RegisterUserInput): User {
    return new User({
      id,
      email,
      name,
      passwordHash,
      emailVerifiedAt: null,
      passwordChangedAt: now,
      createdAt: now,
      version: 1,
    });
  }

  /** Reidrata sem revalidar regras de criação: o estado já foi aceito quando gravado. */
  static restore(snapshot: UserSnapshot): User {
    return new User(snapshot);
  }

  get id(): string {
    return this.state.id;
  }

  get email(): EmailAddress {
    return this.state.email;
  }

  get name(): PersonName {
    return this.state.name;
  }

  get passwordHash(): string {
    return this.state.passwordHash;
  }

  get isEmailVerified(): boolean {
    return this.state.emailVerifiedAt !== null;
  }

  /** BR-017 (posse do e-mail) é verificada no caso de uso; aqui só a transição de estado. */
  verifyEmail(now: Date): void {
    if (this.isEmailVerified) {
      throw new EmailAlreadyVerifiedError();
    }
    this.state = { ...this.state, emailVerifiedAt: now };
  }

  /**
   * Redefinição por link de e-mail comprova a posse do endereço (RF-11): marca como
   * verificado sem falhar se já estiver.
   */
  markEmailVerifiedByReset(now: Date): void {
    if (!this.isEmailVerified) {
      this.state = { ...this.state, emailVerifiedAt: now };
    }
  }

  /** BR-016: revogação de sessões e tokens é orquestrada pelo caso de uso. */
  changePassword(newPasswordHash: string, now: Date): void {
    this.state = { ...this.state, passwordHash: newPasswordHash, passwordChangedAt: now };
  }

  /**
   * Atualiza apenas o algoritmo/parâmetros do hash da mesma senha (rehash no login).
   * Não é troca de senha: não altera `passwordChangedAt` nem afeta sessões.
   */
  rehashPassword(newPasswordHash: string): void {
    this.state = { ...this.state, passwordHash: newPasswordHash };
  }

  toSnapshot(): UserSnapshot {
    return this.state;
  }
}
