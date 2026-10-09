import { randomUUID } from 'node:crypto';
import { EmailAddress, VersionConflictError } from '@taskflow/backend/shared/kernel';
import {
  createPrismaClient,
  PrismaTransactionRunner,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import {
  AlreadyAMemberError,
  Invitation,
  Membership,
  OpenInvitationExistsError,
  Organization,
  OrganizationName,
  OrganizationSlug,
  SlugTakenError,
} from '@taskflow/backend/organizations/domain';
import { PrismaInvitationRepository } from './prisma-invitation.repository';
import { PrismaMembershipRepository } from './prisma-membership.repository';
import { PrismaOrganizationRepository } from './prisma-organization.repository';

const DAY = 24 * 60 * 60 * 1000;

describe('organizations persistence (integration, T6/T7)', () => {
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
    await prisma.$executeRaw`TRUNCATE organizations CASCADE`;
  });

  async function organization(slug = `org-${randomUUID().slice(0, 8)}`) {
    const created = Organization.create({
      id: randomUUID(),
      name: OrganizationName.create('Acme'),
      slug: OrganizationSlug.create(slug),
      now: new Date(),
    });
    await organizations.add(created);
    return created.id;
  }

  async function member(
    organizationId: string,
    role: 'owner' | 'admin' | 'member' = 'member',
    userId = randomUUID(),
  ) {
    await memberships.add(
      Membership.create({ id: randomUUID(), organizationId, userId, role, now: new Date() }),
    );
    return userId;
  }

  /** Falha com mensagem clara em vez de `!` (proibido pelo lint). */
  function present<T>(value: T | null, what: string): T {
    if (value === null) throw new Error(`${what} not found`);
    return value;
  }

  function invitation(organizationId: string, email = 'bia@exemplo.com', now = new Date()) {
    return Invitation.create({
      id: randomUUID(),
      organizationId,
      email: EmailAddress.create(email),
      role: 'member',
      invitedByUserId: randomUUID(),
      deliveryEventId: randomUUID(),
      now,
    });
  }

  describe('constraints (T6)', () => {
    const rawOrganization = (slug: string, name = 'Acme') =>
      prisma.organization.create({
        data: { id: randomUUID(), slug, name, createdAt: new Date(), updatedAt: new Date() },
      });

    it.each(['Acme', 'a--b', 'acme-', '1acme', 'ab'])(
      'BR-022: rejects slug %s in the database',
      async (slug) => {
        await expect(rawOrganization(slug)).rejects.toThrow();
      },
    );

    it('rejects a name that is not trimmed or is too short', async () => {
      await expect(rawOrganization('acme', ' Acme')).rejects.toThrow();
      await expect(rawOrganization('acme', 'A')).rejects.toThrow();
    });

    it('BR-021 / BR-020: rejects owner invitations, non-normalized e-mails and accepted+revoked rows', async () => {
      const organizationId = await organization();
      const base = {
        organizationId,
        invitedByUserId: randomUUID(),
        deliveryEventId: randomUUID(),
        expiresAt: new Date(Date.now() + DAY),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await expect(
        prisma.invitation.create({
          data: { ...base, id: randomUUID(), email: 'a@x.com', role: 'owner' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.invitation.create({
          data: { ...base, id: randomUUID(), email: 'A@x.com', role: 'member' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.invitation.create({
          data: {
            ...base,
            id: randomUUID(),
            email: 'b@x.com',
            role: 'member',
            acceptedAt: new Date(),
            acceptedByUserId: randomUUID(),
            revokedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.invitation.create({
          data: {
            ...base,
            id: randomUUID(),
            email: 'c@x.com',
            role: 'member',
            acceptedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('BR-020: keeps one open invitation per e-mail and organization', async () => {
      const organizationId = await organization();
      const first = invitation(organizationId);
      await invitations.add(first);

      await expect(invitations.add(invitation(organizationId))).rejects.toThrow(
        OpenInvitationExistsError,
      );

      first.revoke(new Date());
      await invitations.save(first);
      await expect(invitations.add(invitation(organizationId))).resolves.toBeUndefined();
    });
  });

  describe('repositories (T7)', () => {
    it('maps unique violations to domain errors', async () => {
      await organization('acme');
      await expect(organization('acme')).rejects.toThrow(SlugTakenError);

      const organizationId = await organization();
      const userId = await member(organizationId);
      await expect(member(organizationId, 'member', userId)).rejects.toThrow(AlreadyAMemberError);
    });

    it('loads several organizations by id in one query, ignoring unknown ids (T9)', async () => {
      const acme = await organization('acme');
      const beta = await organization('beta');
      await organization('fora');

      const found = await organizations.findByIds([acme, randomUUID(), beta]);

      expect(found.map((item) => item.toSnapshot().slug.value).sort()).toEqual(['acme', 'beta']);
      expect(await organizations.findByIds([])).toEqual([]);
    });

    it('never writes across organizations: ids of B with the organization of A change nothing', async () => {
      const organizationA = await organization();
      const organizationB = await organization();
      const userOfB = await member(organizationB, 'admin');
      const invitationOfB = invitation(organizationB);
      await invitations.add(invitationOfB);

      const forged = Membership.restore({
        ...present(await memberships.find(organizationB, userOfB), 'membership').toSnapshot(),
        organizationId: organizationA,
        role: 'owner',
      });
      await expect(memberships.save(forged)).rejects.toThrow(VersionConflictError);
      await expect(memberships.remove(organizationA, userOfB, 1)).rejects.toThrow(
        VersionConflictError,
      );
      expect(await invitations.findById(organizationA, invitationOfB.id)).toBeNull();
      expect(
        await invitations.revokeOpenInvitedBy(
          organizationA,
          invitationOfB.invitedByUserId,
          new Date(),
        ),
      ).toBe(0);

      expect((await memberships.find(organizationB, userOfB))?.role).toBe('admin');
      expect((await invitations.findById(organizationB, invitationOfB.id))?.isOpen).toBe(true);
    });

    it('applies optimistic locking (BR-008) to organizations and memberships', async () => {
      const organizationId = await organization();
      const userId = await member(organizationId);
      const stale = present(await memberships.find(organizationId, userId), 'membership');
      const fresh = present(await memberships.find(organizationId, userId), 'membership');
      fresh.changeRole('admin', new Date());
      await memberships.save(fresh);

      stale.changeRole('member', new Date());
      await expect(memberships.save(stale)).rejects.toThrow(VersionConflictError);
      await expect(memberships.remove(organizationId, userId, 1)).rejects.toThrow(
        VersionConflictError,
      );

      const staleOrganization = present(
        await organizations.findById(organizationId),
        'organization',
      );
      await organizations.save(
        present(await organizations.findById(organizationId), 'organization'),
      );
      await expect(organizations.save(staleOrganization)).rejects.toThrow(VersionConflictError);
    });

    it('serializes membership changes with the organization lock without blocking FK inserts or the version', async () => {
      const organizationId = await organization();
      const order: string[] = [];
      let release: () => void = () => undefined;
      let firstLocked: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const locked = new Promise<void>((resolve) => (firstLocked = resolve));

      const first = transactions.run(async () => {
        expect(await organizations.lockForMembershipChange(organizationId)).toBe(true);
        firstLocked();
        await gate;
        order.push('first-done');
      });
      await locked;
      // Outra transação com seu próprio lock precisa esperar…
      // Outro "processo": runner e repositório próprios, conexão e transação independentes.
      const otherRunner = new PrismaTransactionRunner(prisma);
      const otherRepository = new PrismaOrganizationRepository(otherRunner);
      const second = otherRunner.run(async () => {
        await otherRepository.lockForMembershipChange(organizationId);
        order.push('second-locked');
      });
      // …mas um INSERT com FK para a organização (aceite/convite) não espera o lock.
      await member(organizationId);
      order.push('fk-insert');
      await new Promise((resolve) => setTimeout(resolve, 150));
      release();
      await Promise.all([first, second]);

      expect(order).toEqual(['fk-insert', 'first-done', 'second-locked']);
      expect((await organizations.findById(organizationId))?.version).toBe(1);
    });

    it('pages members by cursor without repeats, and restarts on a tampered cursor', async () => {
      const organizationId = await organization();
      for (let index = 0; index < 5; index += 1) await member(organizationId);

      const seen: string[] = [];
      let cursor: string | null = null;
      const sizes: number[] = [];
      do {
        const page = await memberships.listPage(organizationId, { limit: 2, cursor });
        sizes.push(page.items.length);
        seen.push(...page.items.map((item) => item.userId));
        cursor = page.nextCursor;
      } while (cursor);

      expect(sizes).toEqual([2, 2, 1]);
      expect(new Set(seen).size).toBe(5);
      const restarted = await memberships.listPage(organizationId, { limit: 2, cursor: 'lixo' });
      expect(restarted.items.map((item) => item.userId)).toEqual(seen.slice(0, 2));
    });

    it('BR-020: consumes an invitation only for the invited e-mail, once and before it expires', async () => {
      const organizationId = await organization();
      const open = invitation(organizationId);
      await invitations.add(open);
      const tokenHash = 'a'.repeat(64);
      expect(
        await invitations.issueToken({
          invitationId: open.id,
          deliveryEventId: open.toSnapshot().deliveryEventId,
          tokenHash,
          now: new Date(),
        }),
      ).toBe(true);
      const accept = (email: string, now = new Date()) =>
        invitations.consume({
          tokenHash,
          email: EmailAddress.create(email),
          acceptedByUserId: randomUUID(),
          now,
        });

      expect(await accept('outra@exemplo.com')).toBeNull();
      expect(await invitations.findUsableByTokenHash(tokenHash, new Date())).not.toBeNull();
      expect(await accept('bia@exemplo.com', new Date(Date.now() + 8 * DAY))).toBeNull();
      expect((await accept('bia@exemplo.com'))?.toSnapshot().acceptedAt).not.toBeNull();
      expect(await accept('bia@exemplo.com')).toBeNull();
    });

    it('CA-06: a redelivery invalidates the current link at once; a plain save keeps it', async () => {
      const organizationId = await organization();
      const open = invitation(organizationId);
      await invitations.add(open);
      const tokenHash = 'e'.repeat(64);
      const issued = await invitations.issueToken({
        invitationId: open.id,
        deliveryEventId: open.toSnapshot().deliveryEventId,
        tokenHash,
        now: new Date(),
      });
      expect(issued).toBe(true);

      // Mesmo evento (ex.: revogação de outro convite gravando este sem mudança de envio).
      await invitations.save(open);
      expect((await invitations.findUsableByTokenHash(tokenHash, new Date()))?.id).toBe(open.id);

      open.redeliver({
        deliveryEventId: randomUUID(),
        invitedByUserId: randomUUID(),
        now: new Date(),
      });
      await invitations.save(open);

      expect(await invitations.findUsableByTokenHash(tokenHash, new Date())).toBeNull();
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: open.id } });
      expect(row.tokenHash).toBeNull();
    });

    it('emits the token only for the latest delivery event of an open invitation', async () => {
      const organizationId = await organization();
      const open = invitation(organizationId);
      await invitations.add(open);
      const firstEvent = open.toSnapshot().deliveryEventId;
      open.redeliver({
        deliveryEventId: randomUUID(),
        invitedByUserId: randomUUID(),
        now: new Date(),
      });
      await invitations.save(open);

      const issue = (deliveryEventId: string, tokenHash: string) =>
        invitations.issueToken({
          invitationId: open.id,
          deliveryEventId,
          tokenHash,
          now: new Date(),
        });

      expect(await issue(firstEvent, 'b'.repeat(64))).toBe(false);
      expect(await issue(open.toSnapshot().deliveryEventId, 'c'.repeat(64))).toBe(true);
      open.revoke(new Date());
      await invitations.save(open);
      expect(await issue(open.toSnapshot().deliveryEventId, 'd'.repeat(64))).toBe(false);
    });
  });
});
