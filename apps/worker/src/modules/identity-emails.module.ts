import {
  SendAccountNoticeUseCase,
  SendEmailVerificationUseCase,
  SendPasswordResetUseCase,
} from '@taskflow/backend/identity/application';
import {
  CryptoSecretTokenGenerator,
  PrismaUserRepository,
  PrismaUserTokenRepository,
  ptBrIdentityEmailTemplates,
} from '@taskflow/backend/identity/infrastructure';
import type { EmailSender } from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';

export interface IdentityEmailsModuleDependencies {
  readonly transactions: PrismaTransactionRunner;
  readonly emailSender: EmailSender;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly appUrl: string;
}

/** Composição dos envios de e-mail do contexto identity para o worker (ADR 0011). */
export function createIdentityEmailsModule(deps: IdentityEmailsModuleDependencies) {
  const shared = {
    users: new PrismaUserRepository(deps.transactions),
    emailSender: deps.emailSender,
    templates: ptBrIdentityEmailTemplates,
    appUrl: deps.appUrl,
  };
  const tokenIssuing = {
    ...shared,
    userTokens: new PrismaUserTokenRepository(deps.transactions),
    secretTokens: new CryptoSecretTokenGenerator(),
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  return {
    sendEmailVerification: new SendEmailVerificationUseCase(tokenIssuing),
    sendPasswordReset: new SendPasswordResetUseCase(tokenIssuing),
    sendAccountNotice: new SendAccountNoticeUseCase(shared),
  };
}
