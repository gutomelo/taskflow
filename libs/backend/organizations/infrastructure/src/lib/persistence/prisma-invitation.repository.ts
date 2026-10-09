import type { EmailAddress } from '@taskflow/backend/shared/kernel';
import {
  OpenInvitationExistsError,
  type Invitation,
  type InvitationRepository,
  type Page,
  type PageRequest,
} from '@taskflow/backend/organizations/domain';
import {
  isUniqueConstraintViolation,
  type InvitationRow,
  type PrismaTransactionRunner,
} from '@taskflow/backend/shared/infrastructure';
import { afterPosition, decodeCursor, encodeCursor } from './keyset-cursor';
import { toInvitation } from './organizations-mappers';

const OPEN = { acceptedAt: null, revokedAt: null } as const;

/** Toda operação por id aplica `organizationId` (isolamento); token é a exceção global (hash). */
export class PrismaInvitationRepository implements InvitationRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async add(invitation: Invitation): Promise<void> {
    const snapshot = invitation.toSnapshot();
    try {
      await this.transactions.client().invitation.create({
        data: { ...snapshot, email: snapshot.email.value },
      });
    } catch (error) {
      // Índice único parcial "um aberto por e-mail" (inclusive por corrida).
      if (isUniqueConstraintViolation(error)) throw new OpenInvitationExistsError();
      throw error;
    }
  }

  async save(invitation: Invitation): Promise<void> {
    const {
      id,
      organizationId,
      role,
      invitedByUserId,
      deliveryEventId,
      expiresAt,
      revokedAt,
      updatedAt,
    } = invitation.toSnapshot();
    const client = this.transactions.client();
    // Novo envio (reenvio ou reconvite): o link anterior deixa de valer já (CA-06), mesmo que o
    // worker descarte ou suprima o e-mail novo — senão o prazo renovado valeria para o link antigo.
    await client.invitation.updateMany({
      where: { id, organizationId, NOT: { deliveryEventId } },
      data: { tokenHash: null },
    });
    await client.invitation.updateMany({
      where: { id, organizationId },
      data: { role, invitedByUserId, deliveryEventId, expiresAt, revokedAt, updatedAt },
    });
  }

  async findById(organizationId: string, invitationId: string): Promise<Invitation | null> {
    const row = await this.transactions.client().invitation.findFirst({
      where: { id: invitationId, organizationId },
    });
    return row ? toInvitation(row) : null;
  }

  async findOpenByEmail(organizationId: string, email: EmailAddress): Promise<Invitation | null> {
    const row = await this.transactions.client().invitation.findFirst({
      where: { organizationId, email: email.value, ...OPEN },
    });
    return row ? toInvitation(row) : null;
  }

  async listOpenPage(
    organizationId: string,
    { limit, cursor }: PageRequest,
  ): Promise<Page<Invitation>> {
    const rows = await this.transactions.client().invitation.findMany({
      where: { organizationId, ...OPEN, ...afterPosition(decodeCursor(cursor)) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(toInvitation),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  async revokeOpenInvitedBy(organizationId: string, userId: string, now: Date): Promise<number> {
    const { count } = await this.transactions.client().invitation.updateMany({
      where: { organizationId, invitedByUserId: userId, ...OPEN },
      data: { revokedAt: now, updatedAt: now },
    });
    return count;
  }

  async findUsableByTokenHash(tokenHash: string, now: Date): Promise<Invitation | null> {
    const row = await this.transactions.client().invitation.findFirst({
      where: { tokenHash, ...OPEN, expiresAt: { gt: now } },
    });
    return row ? toInvitation(row) : null;
  }

  async consume({
    tokenHash,
    email,
    acceptedByUserId,
    now,
  }: {
    readonly tokenHash: string;
    readonly email: EmailAddress;
    readonly acceptedByUserId: string;
    readonly now: Date;
  }): Promise<Invitation | null> {
    // Uma instrução: dois aceites (ou aceite × revogação) nunca vencem juntos, e o e-mail da
    // conta é condição do mesmo UPDATE (BR-020).
    const rows = await this.transactions.client().$queryRaw<InvitationRow[]>`
      UPDATE invitations
      SET accepted_at = ${now}, accepted_by_user_id = ${acceptedByUserId}::uuid, updated_at = ${now}
      WHERE token_hash = ${tokenHash}
        AND email = ${email.value}
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > ${now}
      RETURNING id, organization_id AS "organizationId", email, role::text AS role,
        invited_by_user_id AS "invitedByUserId", token_hash AS "tokenHash",
        delivery_event_id AS "deliveryEventId", expires_at AS "expiresAt",
        accepted_at AS "acceptedAt", accepted_by_user_id AS "acceptedByUserId",
        revoked_at AS "revokedAt", created_at AS "createdAt", updated_at AS "updatedAt"`;
    const row = rows[0];
    return row ? toInvitation(row) : null;
  }

  async issueToken({
    invitationId,
    deliveryEventId,
    tokenHash,
    now,
  }: {
    readonly invitationId: string;
    readonly deliveryEventId: string;
    readonly tokenHash: string;
    readonly now: Date;
  }): Promise<boolean> {
    // Só o último evento de envio emite: um retry antigo fora de ordem não troca o link vigente.
    const { count } = await this.transactions.client().invitation.updateMany({
      where: { id: invitationId, deliveryEventId, ...OPEN, expiresAt: { gt: now } },
      data: { tokenHash, updatedAt: now },
    });
    return count > 0;
  }
}
