import type { EmailSender } from '@taskflow/backend/shared/application';
import type { Clock } from '@taskflow/backend/shared/kernel';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';
import {
  FindUserIdByEmailUseCase,
  GetUserAccountsUseCase,
} from '@taskflow/backend/identity/application';
import {
  CryptoSecretTokenGenerator,
  PrismaUserRepository,
} from '@taskflow/backend/identity/infrastructure';
import {
  SendInvitationUseCase,
  type UserDirectory,
} from '@taskflow/backend/organizations/application';
import {
  PrismaInvitationRepository,
  PrismaOrganizationRepository,
  ptBrInvitationEmailTemplates,
} from '@taskflow/backend/organizations/infrastructure';

export interface OrganizationsEmailsModuleDependencies {
  readonly transactions: PrismaTransactionRunner;
  readonly emailSender: EmailSender;
  readonly clock: Clock;
  readonly appUrl: string;
}

/**
 * Porta `UserDirectory` de `organizations` ligada às consultas públicas de `identity` no worker
 * (mesmo adaptador da API; apps não importam umas das outras).
 */
function createUserDirectory(transactions: PrismaTransactionRunner): UserDirectory {
  const users = new PrismaUserRepository(transactions);
  const accounts = new GetUserAccountsUseCase({ users });
  const byEmail = new FindUserIdByEmailUseCase({ users });
  return {
    async getAccounts(userIds) {
      const found = await accounts.execute(userIds);
      return new Map(found.map((account) => [account.id, account]));
    },
    findUserIdByEmail: (email) => byEmail.execute(email),
  };
}

/** Composição dos envios de e-mail do contexto organizations para o worker (spec 002, T16). */
export function createOrganizationsEmailsModule(deps: OrganizationsEmailsModuleDependencies) {
  return {
    sendInvitation: new SendInvitationUseCase({
      invitations: new PrismaInvitationRepository(deps.transactions),
      organizations: new PrismaOrganizationRepository(deps.transactions),
      users: createUserDirectory(deps.transactions),
      tokens: new CryptoSecretTokenGenerator(),
      emailSender: deps.emailSender,
      templates: ptBrInvitationEmailTemplates,
      clock: deps.clock,
      appUrl: deps.appUrl,
    }),
  };
}
