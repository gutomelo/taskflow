import type { Clock } from '@taskflow/backend/shared/kernel';
import type { IdentityDataRetention } from '../ports/identity-data-retention';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Prazos de retenção da spec 001 (design: `PurgeExpiredIdentityData`; RF-15). */
export const IDENTITY_RETENTION_DAYS = {
  /** Sessões encerradas: mantidas 30 dias (dados aproximados do cliente, para o titular). */
  endedSessions: 30,
  /** Tokens de e-mail consumidos ou expirados. */
  endedUserTokens: 7,
  /** RF-15: contas não verificadas e sem login nesse período liberam o e-mail. */
  unverifiedAccounts: 7,
} as const;

export type IdentityPurgeReport = Readonly<{
  unverifiedUsers: number;
  sessions: number;
  userTokens: number;
}>;

/**
 * Worker, job diário. Idempotente: rodar de novo só remove o que venceu desde a última vez.
 * Contas são removidas primeiro; as sessões e tokens delas caem por cascata.
 */
export class PurgeExpiredIdentityDataUseCase {
  constructor(
    private readonly deps: { readonly retention: IdentityDataRetention; readonly clock: Clock },
  ) {}

  async execute(): Promise<IdentityPurgeReport> {
    const now = this.deps.clock.now().getTime();
    const daysAgo = (days: number) => new Date(now - days * DAY_MS);
    const { retention } = this.deps;

    const unverifiedCutoff = daysAgo(IDENTITY_RETENTION_DAYS.unverifiedAccounts);
    const unverifiedUsers = await retention.deleteUnverifiedUsers({
      createdBefore: unverifiedCutoff,
      noActivitySince: unverifiedCutoff,
    });
    const sessions = await retention.deleteSessionsEndedBefore(
      daysAgo(IDENTITY_RETENTION_DAYS.endedSessions),
    );
    const userTokens = await retention.deleteUserTokensEndedBefore(
      daysAgo(IDENTITY_RETENTION_DAYS.endedUserTokens),
    );
    return { unverifiedUsers, sessions, userTokens };
  }
}
