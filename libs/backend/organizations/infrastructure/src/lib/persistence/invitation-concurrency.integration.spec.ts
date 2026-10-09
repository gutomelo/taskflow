import { randomUUID } from 'node:crypto';
import type { OrganizationRole, TenantRequestContext } from '@taskflow/backend/shared/application';
import {
  fakePseudonymizer,
  FixedClock,
  InMemoryRateLimiter,
} from '@taskflow/backend/shared/application/testing';
import {
  createPrismaClient,
  PrismaOutboxWriter,
  PrismaTransactionRunner,
  UuidV7Generator,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import {
  Membership,
  Organization,
  OrganizationName,
  OrganizationSlug,
} from '@taskflow/backend/organizations/domain';
import {
  AcceptInvitationUseCase,
  InvalidOrExpiredInvitationError,
  InvitationNotFoundError,
  InviteMemberUseCase,
  RevokeInvitationUseCase,
} from '@taskflow/backend/organizations/application';
import {
  FakeInvitationTokens,
  InMemoryUserDirectory,
  RecordingOrganizationsSecurityEvents,
} from '@taskflow/backend/organizations/application/testing';
import { PrismaInvitationRepository } from './prisma-invitation.repository';
import { PrismaMembershipRepository } from './prisma-membership.repository';
import { PrismaOrganizationRepository } from './prisma-organization.repository';

/** Promessa com o `resolve` exposto (equivalente a `Promise.withResolvers`, fora da lib ES2022). */
function signal() {
  const box: { resolve: () => void } = { resolve: () => undefined };
  const promise = new Promise<void>((resolve) => {
    box.resolve = resolve;
  });
  return { promise, resolve: () => box.resolve() };
}

describe('invitations under concurrency (integration, T11/T12)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let organizations: PrismaOrganizationRepository;
  let memberships: PrismaMembershipRepository;
  let invitations: PrismaInvitationRepository;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma);
    organizations = new PrismaOrganizationRepository(transactions);
    memberships = new PrismaMembershipRepository(transactions);
    invitations = new PrismaInvitationRepository(transactions);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE organizations, outbox_events CASCADE`;
  });

  // Um gerador para o arquivo todo: tokens repetidos entre testes violariam o único `token_hash`.
  const tokens = new FakeInvitationTokens();

  function dependencies() {
    const users = new InMemoryUserDirectory();
    return {
      organizations,
      memberships,
      invitations,
      transactions,
      users,
      tokens,
      rateLimiter: new InMemoryRateLimiter(),
      pseudonymizer: fakePseudonymizer,
      outbox: new PrismaOutboxWriter(transactions),
      securityEvents: new RecordingOrganizationsSecurityEvents(),
      idGenerator: new UuidV7Generator(),
      clock: new FixedClock(new Date()),
    };
  }

  async function seedOrganization(ownerId: string) {
    const now = new Date();
    const organization = Organization.create({
      id: randomUUID(),
      name: OrganizationName.create('Acme'),
      slug: OrganizationSlug.create(`org-${randomUUID().slice(0, 8)}`),
      now,
    });
    await organizations.add(organization);
    await memberships.add(
      Membership.create({
        id: randomUUID(),
        organizationId: organization.id,
        userId: ownerId,
        role: 'owner',
        now,
      }),
    );
    return organization.id;
  }

  function as(
    userId: string,
    organizationId: string,
    role: OrganizationRole,
  ): TenantRequestContext {
    return {
      requestId: randomUUID(),
      actor: { userId, sessionId: randomUUID() },
      tenant: { organizationId, organizationRole: role },
    };
  }

  it('two simultaneous invitations to one e-mail become an invitation and a re-invitation, never a 500', async () => {
    const owner = randomUUID();
    const organizationId = await seedOrganization(owner);
    const deps = dependencies();
    deps.users.add({ id: owner, name: 'Ana', email: 'ana@exemplo.com', emailVerified: true });
    // Limite por (organização, e-mail) fora do caminho: o teste é a corrida no banco.
    vi.spyOn(deps.rateLimiter, 'consume').mockResolvedValue({ allowed: true, remainingPoints: 1 });
    const invite = new InviteMemberUseCase(deps);

    const results = await Promise.all([
      invite.execute(as(owner, organizationId, 'owner'), {
        email: 'bia@exemplo.com',
        role: 'viewer',
      }),
      invite.execute(as(owner, organizationId, 'owner'), {
        email: 'bia@exemplo.com',
        role: 'member',
      }),
    ]);

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(await prisma.invitation.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(2);
  });

  it('BR-020: acceptance and revocation at once have exactly one winner, consistently', async () => {
    for (let round = 0; round < 5; round += 1) {
      const owner = randomUUID();
      const invited = randomUUID();
      const organizationId = await seedOrganization(owner);
      const deps = dependencies();
      deps.users.add({ id: owner, name: 'Ana', email: 'ana@exemplo.com', emailVerified: true });
      deps.users.add({
        id: invited,
        name: 'Bia',
        email: `bia-${round}@exemplo.com`,
        emailVerified: true,
      });
      const { invitation } = await new InviteMemberUseCase(deps).execute(
        as(owner, organizationId, 'owner'),
        {
          email: `bia-${round}@exemplo.com`,
          role: 'member',
        },
      );
      const delivery = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      const { token, tokenHash } = deps.tokens.generate();
      await invitations.issueToken({
        invitationId: invitation.id,
        deliveryEventId: delivery.deliveryEventId,
        tokenHash,
        now: new Date(),
      });

      const [accepted, revoked] = await Promise.allSettled([
        new AcceptInvitationUseCase(deps).execute(
          { requestId: randomUUID(), actor: { userId: invited, sessionId: randomUUID() } },
          { token },
        ),
        new RevokeInvitationUseCase(deps).execute(
          as(owner, organizationId, 'owner'),
          invitation.id,
        ),
      ]);

      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      const member = await prisma.membership.findFirst({
        where: { organizationId, userId: invited },
      });
      if (accepted.status === 'fulfilled') {
        expect(revoked.status === 'rejected' && revoked.reason).toBeInstanceOf(
          InvitationNotFoundError,
        );
        expect([row.acceptedAt, row.revokedAt, member?.role]).toEqual([
          expect.any(Date),
          null,
          'member',
        ]);
      } else {
        expect(accepted.reason).toBeInstanceOf(InvalidOrExpiredInvitationError);
        expect(revoked.status).toBe('fulfilled');
        expect([row.acceptedAt, row.revokedAt, member]).toEqual([null, expect.any(Date), null]);
      }
    }
  });

  it('a revocation that waits for an acceptance answers 404, never a constraint error', async () => {
    const owner = randomUUID();
    const invited = randomUUID();
    const organizationId = await seedOrganization(owner);
    const deps = dependencies();
    deps.users.add({ id: owner, name: 'Ana', email: 'ana@exemplo.com', emailVerified: true });
    deps.users.add({ id: invited, name: 'Bia', email: 'bia@exemplo.com', emailVerified: true });
    const { invitation } = await new InviteMemberUseCase(deps).execute(
      as(owner, organizationId, 'owner'),
      {
        email: 'bia@exemplo.com',
        role: 'member',
      },
    );
    const delivery = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    const { token, tokenHash } = deps.tokens.generate();
    await invitations.issueToken({
      invitationId: invitation.id,
      deliveryEventId: delivery.deliveryEventId,
      tokenHash,
      now: new Date(),
    });
    // O aceite consome, cria a membership e segura a transação (e o lock) antes do commit.
    const consumed = signal();
    const add = memberships.add.bind(memberships);
    const spy = vi.spyOn(memberships, 'add').mockImplementation(async (membership) => {
      await add(membership);
      consumed.resolve();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const acceptance = new AcceptInvitationUseCase(deps).execute(
      { requestId: randomUUID(), actor: { userId: invited, sessionId: randomUUID() } },
      { token },
    );
    await consumed.promise;
    // Sem o lock, a revogação leria o convite ainda aberto e gravaria `revoked_at` sobre o aceite.
    const revocation = new RevokeInvitationUseCase(deps).execute(
      as(owner, organizationId, 'owner'),
      invitation.id,
    );

    await expect(acceptance).resolves.toMatchObject({ id: organizationId, role: 'member' });
    await expect(revocation).rejects.toBeInstanceOf(InvitationNotFoundError);
    spy.mockRestore();
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect([row.acceptedAt, row.revokedAt]).toEqual([expect.any(Date), null]);
  });

  it('BR-020: two acceptances of the same token by the right account create one membership', async () => {
    const owner = randomUUID();
    const invited = randomUUID();
    const organizationId = await seedOrganization(owner);
    const deps = dependencies();
    deps.users.add({ id: owner, name: 'Ana', email: 'ana@exemplo.com', emailVerified: true });
    deps.users.add({ id: invited, name: 'Bia', email: 'bia@exemplo.com', emailVerified: true });
    const { invitation } = await new InviteMemberUseCase(deps).execute(
      as(owner, organizationId, 'owner'),
      {
        email: 'bia@exemplo.com',
        role: 'viewer',
      },
    );
    const delivery = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    const { token, tokenHash } = deps.tokens.generate();
    await invitations.issueToken({
      invitationId: invitation.id,
      deliveryEventId: delivery.deliveryEventId,
      tokenHash,
      now: new Date(),
    });
    const accept = new AcceptInvitationUseCase(deps);
    const context = {
      requestId: randomUUID(),
      actor: { userId: invited, sessionId: randomUUID() },
    };

    const results = await Promise.allSettled([
      accept.execute(context, { token }),
      accept.execute(context, { token }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await prisma.membership.count({ where: { organizationId, userId: invited } })).toBe(1);
  });
});
