import type { RequestContext } from '@taskflow/backend/shared/application';
import type { Clock } from '@taskflow/backend/shared/kernel';
import type { SessionRepository } from '@taskflow/backend/identity/domain';
import { summarizeUserAgent, type DeviceSummary } from '../shared/user-agent';

export type SessionSummary = Readonly<{
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  device: DeviceSummary;
  isCurrent: boolean;
}>;

/** RF-08. Apenas sessões ativas do próprio usuário; nunca expõe IP nem tokens. */
export class ListSessionsUseCase {
  constructor(
    private readonly deps: { readonly sessions: SessionRepository; readonly clock: Clock },
  ) {}

  async execute(context: RequestContext): Promise<ReadonlyArray<SessionSummary>> {
    const sessions = await this.deps.sessions.listActiveByUser(
      context.actor.userId,
      this.deps.clock.now(),
    );
    return sessions.map((session) => {
      const snapshot = session.toSnapshot();
      return {
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        lastUsedAt: snapshot.lastUsedAt,
        device: summarizeUserAgent(snapshot.client.userAgent),
        isCurrent: snapshot.id === context.actor.sessionId,
      };
    });
  }
}
