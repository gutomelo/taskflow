import type { Clock } from '@taskflow/backend/shared/kernel';
import type { InvitationRetention } from '../ports/invitation-retention';

/** RNF-08: convites encerrados (aceitos, revogados, expirados) ficam 30 dias. */
export const CLOSED_INVITATION_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Worker, job diário (spec 002, T17). Idempotente: só remove o que venceu desde a última vez. */
export class PurgeClosedInvitationsUseCase {
  constructor(
    private readonly deps: { readonly retention: InvitationRetention; readonly clock: Clock },
  ) {}

  async execute(): Promise<Readonly<{ closedInvitations: number }>> {
    const cutoff = new Date(
      this.deps.clock.now().getTime() - CLOSED_INVITATION_RETENTION_DAYS * DAY_MS,
    );
    return { closedInvitations: await this.deps.retention.deleteClosedBefore(cutoff) };
  }
}
