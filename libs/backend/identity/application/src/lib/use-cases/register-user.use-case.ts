import {
  createIntegrationEvent,
  type OutboxWriter,
  type TransactionRunner,
} from '@taskflow/backend/shared/application';
import { EmailAddress, type Clock, type IdGenerator } from '@taskflow/backend/shared/kernel';
import {
  EmailAlreadyRegisteredError,
  Password,
  PersonName,
  User,
  type CommonPasswordList,
  type PasswordHasher,
  type UserRepository,
} from '@taskflow/backend/identity/domain';
import type { EmailDeliveryThrottle } from '../shared/email-delivery-throttle';
import { IdentityEventType } from '../shared/identity-events';

export type RegisterUserCommand = Readonly<{ name: string; email: string; password: string }>;

export interface RegisterUserDependencies {
  readonly users: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly commonPasswords: CommonPasswordList;
  readonly emailThrottle: EmailDeliveryThrottle;
  readonly transactions: TransactionRunner;
  readonly outbox: OutboxWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * RF-01/RF-02. Responde igual exista ou não a conta (BR-014): não retorna nada; o titular de
 * conta existente recebe um aviso em vez do link. Erros só por entrada inválida (formato,
 * BR-011), que não dependem da existência da conta.
 */
export class RegisterUserUseCase {
  constructor(private readonly deps: RegisterUserDependencies) {}

  async execute(command: RegisterUserCommand): Promise<void> {
    const email = EmailAddress.create(command.email);
    const name = PersonName.create(command.name);
    const password = Password.create(command.password, {
      email,
      commonPasswords: this.deps.commonPasswords,
    });
    // Hash sempre, antes de consultar a conta: o tempo de resposta não revela se ela existe.
    const passwordHash = await this.deps.passwordHasher.hash(password);
    const deliveryAllowed = await this.deps.emailThrottle.allowVerification(email);

    await this.deps.transactions.run(async () => {
      const existing = await this.deps.users.findByEmail(email);
      if (existing) {
        await this.notifyExistingAccount(existing.id, deliveryAllowed);
        return;
      }

      const user = User.register({
        id: this.deps.idGenerator.generate(),
        email,
        name,
        passwordHash,
        now: this.deps.clock.now(),
      });
      try {
        await this.deps.users.add(user);
      } catch (error) {
        if (error instanceof EmailAlreadyRegisteredError) {
          // Cadastro concorrente venceu: mesma resposta, sem e-mail extra.
          return;
        }
        throw error;
      }
      if (deliveryAllowed) {
        await this.emit(IdentityEventType.emailVerificationRequested, user.id);
      }
    });
  }

  private async notifyExistingAccount(userId: string, deliveryAllowed: boolean): Promise<void> {
    if (deliveryAllowed) {
      await this.emit(IdentityEventType.accountAlreadyExistsNotice, userId);
    }
  }

  private emit(type: IdentityEventType, userId: string): Promise<void> {
    return this.deps.outbox.append([
      createIntegrationEvent(
        type,
        { userId },
        { idGenerator: this.deps.idGenerator, clock: this.deps.clock },
      ),
    ]);
  }
}
