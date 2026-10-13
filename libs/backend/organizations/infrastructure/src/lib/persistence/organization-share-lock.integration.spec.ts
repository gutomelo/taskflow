import { randomUUID } from 'node:crypto';
import type { OrganizationRole } from '@taskflow/backend/shared/kernel';
import {
  createPrismaClient,
  PrismaTransactionRunner,
  TransactionRequiredError,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import { PrismaMembershipRepository } from './prisma-membership.repository';
import { PrismaOrganizationRepository } from './prisma-organization.repository';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Spec 003 (T4): o `FOR SHARE` de `projects` serializa com as mutações de membership
 * (`FOR NO KEY UPDATE`) e convive com outros `FOR SHARE`.
 */
describe('organization share lock (integration, spec 003 T4)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let organizations: PrismaOrganizationRepository;
  let memberships: PrismaMembershipRepository;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma, { timeoutMs: 10_000 });
    organizations = new PrismaOrganizationRepository(transactions);
    memberships = new PrismaMembershipRepository(transactions);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE organizations CASCADE`;
  });

  async function organization(members: ReadonlyArray<readonly [string, OrganizationRole]> = []) {
    const id = randomUUID();
    const now = new Date();
    await prisma.organization.create({
      data: { id, name: 'Acme', slug: `org-${id.slice(0, 8)}`, createdAt: now },
    });
    for (const [userId, role] of members) {
      await prisma.membership.create({
        data: { id: randomUUID(), organizationId: id, userId, role, createdAt: now },
      });
    }
    return id;
  }

  /** Segura o `FOR SHARE` por `holdMs` e registra quando a transação termina. */
  function holdShareLock(organizationId: string, order: string[], holdMs: number) {
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const done = transactions.run(async () => {
      await organizations.lockForShare(organizationId);
      locked();
      await sleep(holdMs);
      order.push('share released');
    });
    return { isLocked, done };
  }

  it('fails closed outside a transaction and answers null for an unknown organization', async () => {
    await expect(organizations.lockForShare(randomUUID())).rejects.toBeInstanceOf(
      TransactionRequiredError,
    );
    expect(await transactions.run(() => organizations.lockForShare(randomUUID()))).toBeNull();
  });

  it('holds membership changes until the commit of the projects transaction', async () => {
    const organizationId = await organization();
    const order: string[] = [];
    const share = holdShareLock(organizationId, order, 400);
    await share.isLocked;

    const membershipChange = transactions.run(async () => {
      await organizations.lockForMembershipChange(organizationId);
      order.push('membership locked');
    });
    await Promise.all([share.done, membershipChange]);

    expect(order).toEqual(['share released', 'membership locked']);
  });

  it('lets other projects transactions share the lock in parallel', async () => {
    const organizationId = await organization();
    const order: string[] = [];
    const share = holdShareLock(organizationId, order, 400);
    await share.isLocked;

    await transactions.run(async () => {
      expect(await organizations.lockForShare(organizationId)).not.toBeNull();
      order.push('second share locked');
    });
    await share.done;

    expect(order).toEqual(['second share locked', 'share released']);
  });

  it('reads roles of members only and pages members excluding some users', async () => {
    const [ana, bia, caio] = [randomUUID(), randomUUID(), randomUUID()];
    const organizationId = await organization([
      [ana, 'owner'],
      [bia, 'viewer'],
      [caio, 'member'],
    ]);
    const other = await organization([[randomUUID(), 'owner']]);

    expect(await memberships.rolesOf(organizationId, [ana, bia, randomUUID()])).toEqual(
      new Map([
        [ana, 'owner'],
        [bia, 'viewer'],
      ]),
    );
    expect(await memberships.rolesOf(other, [ana])).toEqual(new Map());
    const page = await memberships.listPageExcluding(
      organizationId,
      { excludeUserIds: [bia], roles: ['member', 'viewer'] },
      { limit: 10, cursor: null },
    );
    expect(page.items.map((member) => member.userId)).toEqual([caio]);
  });
});
