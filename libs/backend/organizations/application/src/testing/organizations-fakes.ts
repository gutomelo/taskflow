import { createHash } from 'node:crypto';
import type { EmailAddress } from '@taskflow/backend/shared/kernel';
import { VersionConflictError } from '@taskflow/backend/shared/kernel';
import {
  FakeTransactionRunner,
  FixedClock,
  InMemoryOutbox,
  InMemoryRateLimiter,
  RecordingEmailSender,
  SequentialIds,
  fakePseudonymizer,
  type TransactionalStore,
} from '@taskflow/backend/shared/application/testing';
import {
  AlreadyAMemberError,
  Invitation,
  Membership,
  OpenInvitationExistsError,
  Organization,
  SlugTakenError,
  type InvitationRepository,
  type InvitationSnapshot,
  type MembershipRepository,
  type MembershipSnapshot,
  type OrganizationRepository,
  type OrganizationSnapshot,
  type Page,
  type PageRequest,
} from '@taskflow/backend/organizations/domain';
import type { InvitationEmailTemplates } from '../lib/ports/invitation-email-templates';
import type { InvitationTokenGenerator } from '../lib/ports/invitation-token-generator';
import {
  MAX_USER_ACCOUNTS_PER_QUERY,
  type UserAccount,
  type UserDirectory,
} from '../lib/ports/user-directory';
import type {
  OrganizationsSecurityEvent,
  OrganizationsSecurityEventRecorder,
} from '../lib/shared/organizations-security-events';

export class InMemoryUserDirectory implements UserDirectory {
  readonly accounts = new Map<string, UserAccount>();
  /** Ids pedidos em cada chamada, para os testes verificarem consultas em lote (sem N+1). */
  readonly queries: (readonly string[])[] = [];

  add(account: UserAccount): UserAccount {
    this.accounts.set(account.id, account);
    return account;
  }

  async getAccounts(userIds: readonly string[]) {
    this.queries.push([...userIds]);
    if (new Set(userIds).size > MAX_USER_ACCOUNTS_PER_QUERY) {
      throw new RangeError(`At most ${MAX_USER_ACCOUNTS_PER_QUERY} accounts per query`);
    }
    const found = new Map<string, UserAccount>();
    for (const id of userIds) {
      const account = this.accounts.get(id);
      if (account) found.set(id, account);
    }
    return found;
  }

  async findUserIdByEmail(email: EmailAddress) {
    const account = [...this.accounts.values()].find(
      (candidate) => candidate.email === email.value,
    );
    return account?.id ?? null;
  }
}

export class InMemoryOrganizationRepository implements OrganizationRepository, TransactionalStore {
  rows = new Map<string, OrganizationSnapshot>();
  /** Organizações travadas, na ordem (os testes verificam que mutações de membership travam). */
  readonly locks: string[] = [];
  /** Lotes pedidos a `findByIds` (sem N+1). */
  readonly batches: (readonly string[])[] = [];

  snapshot() {
    return new Map(this.rows);
  }
  restore(state: unknown) {
    this.rows = state as Map<string, OrganizationSnapshot>;
  }

  async add(organization: Organization) {
    const snapshot = organization.toSnapshot();
    if ([...this.rows.values()].some((row) => row.slug.value === snapshot.slug.value)) {
      throw new SlugTakenError();
    }
    this.rows.set(snapshot.id, snapshot);
  }
  async findById(organizationId: string) {
    const row = this.rows.get(organizationId);
    return row ? Organization.restore(row) : null;
  }
  async findByIds(organizationIds: ReadonlyArray<string>) {
    this.batches.push([...organizationIds]);
    return organizationIds.flatMap((id) => {
      const row = this.rows.get(id);
      return row ? [Organization.restore(row)] : [];
    });
  }
  async save(organization: Organization) {
    const snapshot = organization.toSnapshot();
    const stored = this.rows.get(snapshot.id);
    if (!stored || stored.version !== snapshot.version) {
      throw new VersionConflictError('Organization');
    }
    this.rows.set(snapshot.id, { ...snapshot, version: snapshot.version + 1 });
  }
  async lockForMembershipChange(organizationId: string) {
    this.locks.push(organizationId);
    return this.rows.has(organizationId);
  }
}

const membershipKey = (organizationId: string, userId: string) => `${organizationId}|${userId}`;

export class InMemoryMembershipRepository implements MembershipRepository, TransactionalStore {
  /** Ordem de inserção = ordem de entrada (como o `created_at, id` do Prisma). */
  rows = new Map<string, MembershipSnapshot>();

  snapshot() {
    return new Map(this.rows);
  }
  restore(state: unknown) {
    this.rows = state as Map<string, MembershipSnapshot>;
  }

  async add(membership: Membership) {
    const snapshot = membership.toSnapshot();
    const key = membershipKey(snapshot.organizationId, snapshot.userId);
    if (this.rows.has(key)) throw new AlreadyAMemberError();
    this.rows.set(key, snapshot);
  }
  async find(organizationId: string, userId: string) {
    const row = this.rows.get(membershipKey(organizationId, userId));
    return row ? Membership.restore(row) : null;
  }
  async listPage(organizationId: string, page: PageRequest): Promise<Page<Membership>> {
    const all = this.inOrganization(organizationId);
    // Cursor do fake: posição na lista (o real é keyset opaco).
    const start = page.cursor === null ? 0 : Number(page.cursor);
    const items = all.slice(start, start + page.limit).map((row) => Membership.restore(row));
    const next = start + page.limit;
    return { items, nextCursor: next < all.length ? String(next) : null };
  }
  async listForUser(userId: string) {
    return this.all()
      .filter((row) => row.userId === userId)
      .map((row) => Membership.restore(row));
  }
  async countForUser(userId: string) {
    return this.all().filter((row) => row.userId === userId).length;
  }
  async countOwnedBy(userId: string) {
    return this.all().filter((row) => row.userId === userId && row.role === 'owner').length;
  }
  async countOwners(organizationId: string) {
    return this.inOrganization(organizationId).filter((row) => row.role === 'owner').length;
  }
  async save(membership: Membership) {
    const snapshot = membership.toSnapshot();
    const key = membershipKey(snapshot.organizationId, snapshot.userId);
    const stored = this.rows.get(key);
    if (!stored || stored.version !== snapshot.version) {
      throw new VersionConflictError('Membership');
    }
    this.rows.set(key, { ...snapshot, version: snapshot.version + 1 });
  }
  async remove(organizationId: string, userId: string, version: number) {
    const key = membershipKey(organizationId, userId);
    if (this.rows.get(key)?.version !== version) throw new VersionConflictError('Membership');
    this.rows.delete(key);
  }

  private all() {
    return [...this.rows.values()];
  }
  private inOrganization(organizationId: string) {
    return this.all().filter((row) => row.organizationId === organizationId);
  }
}

type InvitationRow = { snapshot: InvitationSnapshot; tokenHash: string | null };

const isOpenRow = ({ snapshot }: InvitationRow) =>
  snapshot.acceptedAt === null && snapshot.revokedAt === null;

/** Mesma semântica do repositório Prisma (único parcial, token apagado no reenvio, consumo condicional). */
export class InMemoryInvitationRepository implements InvitationRepository, TransactionalStore {
  /** Ordem de inserção = ordem de criação. */
  rows = new Map<string, InvitationRow>();

  snapshot() {
    return new Map([...this.rows].map(([id, row]) => [id, { ...row }]));
  }
  restore(state: unknown) {
    this.rows = state as Map<string, InvitationRow>;
  }

  async add(invitation: Invitation) {
    const snapshot = invitation.toSnapshot();
    const duplicate = [...this.rows.values()].some(
      (row) =>
        isOpenRow(row) &&
        row.snapshot.organizationId === snapshot.organizationId &&
        row.snapshot.email.value === snapshot.email.value,
    );
    if (duplicate) throw new OpenInvitationExistsError();
    this.rows.set(snapshot.id, { snapshot, tokenHash: null });
  }
  async save(invitation: Invitation) {
    const snapshot = invitation.toSnapshot();
    const row = this.rows.get(snapshot.id);
    if (!row || row.snapshot.organizationId !== snapshot.organizationId) return;
    const redelivered = row.snapshot.deliveryEventId !== snapshot.deliveryEventId;
    this.rows.set(snapshot.id, {
      // Aceite só acontece por `consume`; `save` não o grava (como no Prisma).
      snapshot: {
        ...snapshot,
        acceptedAt: row.snapshot.acceptedAt,
        acceptedByUserId: row.snapshot.acceptedByUserId,
      },
      tokenHash: redelivered ? null : row.tokenHash,
    });
  }
  async findById(organizationId: string, invitationId: string) {
    const row = this.rows.get(invitationId);
    return row && row.snapshot.organizationId === organizationId
      ? Invitation.restore(row.snapshot)
      : null;
  }
  async findForDelivery(invitationId: string) {
    const row = this.rows.get(invitationId);
    return row ? Invitation.restore(row.snapshot) : null;
  }
  async findOpenByEmail(organizationId: string, email: EmailAddress) {
    const row = [...this.rows.values()].find(
      (candidate) =>
        isOpenRow(candidate) &&
        candidate.snapshot.organizationId === organizationId &&
        candidate.snapshot.email.value === email.value,
    );
    return row ? Invitation.restore(row.snapshot) : null;
  }
  async listOpenPage(organizationId: string, page: PageRequest): Promise<Page<Invitation>> {
    const all = [...this.rows.values()].filter(
      (row) => isOpenRow(row) && row.snapshot.organizationId === organizationId,
    );
    const start = page.cursor === null ? 0 : Number(page.cursor);
    const items = all
      .slice(start, start + page.limit)
      .map((row) => Invitation.restore(row.snapshot));
    const next = start + page.limit;
    return { items, nextCursor: next < all.length ? String(next) : null };
  }
  async revokeOpenInvitedBy(organizationId: string, userId: string, now: Date) {
    let count = 0;
    for (const row of this.rows.values()) {
      if (
        isOpenRow(row) &&
        row.snapshot.organizationId === organizationId &&
        row.snapshot.invitedByUserId === userId
      ) {
        row.snapshot = { ...row.snapshot, revokedAt: now, updatedAt: now };
        count += 1;
      }
    }
    return count;
  }
  async findUsableByTokenHash(tokenHash: string, now: Date) {
    const row = this.usable(tokenHash, now);
    return row ? Invitation.restore(row.snapshot) : null;
  }
  async consume(input: {
    readonly tokenHash: string;
    readonly email: EmailAddress;
    readonly acceptedByUserId: string;
    readonly now: Date;
  }) {
    const row = this.usable(input.tokenHash, input.now);
    if (!row || row.snapshot.email.value !== input.email.value) return null;
    row.snapshot = {
      ...row.snapshot,
      acceptedAt: input.now,
      acceptedByUserId: input.acceptedByUserId,
      updatedAt: input.now,
    };
    return Invitation.restore(row.snapshot);
  }
  async issueToken(input: {
    readonly invitationId: string;
    readonly deliveryEventId: string;
    readonly tokenHash: string;
    readonly now: Date;
  }) {
    const row = this.rows.get(input.invitationId);
    if (
      !row ||
      !isOpenRow(row) ||
      row.snapshot.deliveryEventId !== input.deliveryEventId ||
      row.snapshot.expiresAt.getTime() <= input.now.getTime()
    ) {
      return false;
    }
    row.tokenHash = input.tokenHash;
    row.snapshot = { ...row.snapshot, updatedAt: input.now };
    return true;
  }

  private usable(tokenHash: string, now: Date) {
    return [...this.rows.values()].find(
      (row) =>
        row.tokenHash === tokenHash &&
        isOpenRow(row) &&
        row.snapshot.expiresAt.getTime() > now.getTime(),
    );
  }
}

/** Tokens previsíveis com o hash real (SHA-256 hex), como o gerador de `identity`. */
export class FakeInvitationTokens implements InvitationTokenGenerator {
  private next = 0;
  generate() {
    this.next += 1;
    const token = `fake-invitation-token-${String(this.next).padStart(21, '0')}`;
    return { token, tokenHash: this.hash(token) };
  }
  hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}

export class RecordingOrganizationsSecurityEvents implements OrganizationsSecurityEventRecorder {
  events: OrganizationsSecurityEvent[] = [];
  record(event: OrganizationsSecurityEvent) {
    this.events.push(event);
  }
  types(): string[] {
    return this.events.map((event) => event.type);
  }
}

/** Templates que expõem os dados recebidos (o texto real é testado na infraestrutura). */
export const fakeInvitationEmailTemplates: InvitationEmailTemplates = {
  invitation: ({ to, ...data }) => {
    const text = JSON.stringify({ template: 'invitation', ...data });
    return { to, subject: 'invitation', text, html: text };
  },
};

/** Grafo completo de fakes para os testes de casos de uso de `organizations`. */
export function createOrganizationsTestbed() {
  const transactions = new FakeTransactionRunner();
  const organizations = new InMemoryOrganizationRepository();
  const memberships = new InMemoryMembershipRepository();
  const invitations = new InMemoryInvitationRepository();
  const outbox = new InMemoryOutbox(transactions);
  transactions.register(organizations, memberships, invitations, outbox);
  return {
    transactions,
    organizations,
    memberships,
    invitations,
    outbox,
    users: new InMemoryUserDirectory(),
    tokens: new FakeInvitationTokens(),
    emailSender: new RecordingEmailSender(),
    templates: fakeInvitationEmailTemplates,
    appUrl: 'https://app.taskflow.test',
    rateLimiter: new InMemoryRateLimiter(),
    securityEvents: new RecordingOrganizationsSecurityEvents(),
    pseudonymizer: fakePseudonymizer,
    clock: new FixedClock(),
    idGenerator: new SequentialIds(),
  };
}

export type OrganizationsTestbed = ReturnType<typeof createOrganizationsTestbed>;
