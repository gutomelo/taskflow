import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { pino } from 'pino';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { CollaborationIntegrationEventType } from '@taskflow/backend/collaboration/application';
import {
  createPrismaClient,
  createRedisClient,
  SmtpEmailSender,
  SystemClock,
  UuidV7Generator,
  type OutboxJobData,
  type PrismaClient,
  type Redis,
} from '@taskflow/backend/shared/infrastructure';
import { startPostgresTestDatabase } from '@taskflow/backend/shared/infrastructure/testing';
import type { PostgresTestDatabase } from '@taskflow/backend/shared/infrastructure/testing';
import { TasksIntegrationEventType } from '@taskflow/backend/tasks/application';
import { DIGEST_SUBJECT } from '@taskflow/backend/notifications/infrastructure';
import { createMaintenance } from './maintenance';
import {
  createNotificationDelivery,
  DIGEST_SEND_JOB_NAME,
  digestJobId,
  type NotificationDelivery,
} from './notification-delivery';
import { createOutboxRelay } from './outbox-relay';

const APP_URL = 'http://localhost:4200';
const DAY = 24 * 60 * 60 * 1000;

type MailpitSummary = { ID: string; Subject: string; To: Array<{ Address: string }> };
type MailpitMessage = MailpitSummary & { Text: string; HTML: string };

describe('notification pipeline (integration: PostgreSQL + Redis + Mailpit)', () => {
  let database: PostgresTestDatabase;
  let redisContainer: StartedTestContainer;
  let mailpit: StartedTestContainer;
  let prisma: PrismaClient;
  let redis: Redis;
  let redisUrl: string;
  let smtp: SmtpEmailSender;
  let delivery: NotificationDelivery | undefined;
  let relay: ReturnType<typeof createOutboxRelay> | undefined;

  const mailpitApi = () => `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}/api/v1`;

  beforeAll(async () => {
    [database, redisContainer, mailpit] = await Promise.all([
      startPostgresTestDatabase(),
      new GenericContainer('redis:8-alpine').withExposedPorts(6379).start(),
      new GenericContainer('axllent/mailpit:v1.31')
        .withExposedPorts(1025, 8025)
        .withWaitStrategy(Wait.forHttp('/readyz', 8025))
        .start(),
    ]);
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    redis = createRedisClient({ redisUrl, connectionName: 'notification-delivery-test' });
    await redis.connect();
    smtp = new SmtpEmailSender({
      smtpUrl: `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`,
      from: 'TaskFlow <nao-responda@taskflow.local>',
    });
  });

  afterAll(async () => {
    await relay?.stop();
    await delivery?.stop();
    smtp?.close();
    redis?.disconnect();
    await prisma?.$disconnect();
    await Promise.all([database?.stop(), redisContainer?.stop(), mailpit?.stop()]);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE organizations, users, outbox_events CASCADE`;
    await redis.flushdb();
    await fetch(`${mailpitApi()}/messages`, { method: 'DELETE' });
    delivery = createNotificationDelivery({
      prisma,
      redis,
      redisUrl,
      emailSender: smtp,
      appUrl: APP_URL,
      idGenerator: new UuidV7Generator(),
      clock: new SystemClock(),
      logger: pino({ level: 'silent' }),
      jobOptions: { backoff: { type: 'fixed', delay: 100 } },
    });
    relay = createOutboxRelay({
      prisma,
      routes: [delivery.routes],
      clock: new SystemClock(),
      logger: pino({ level: 'silent' }),
      pollIntervalMs: 50,
    });
  });

  afterEach(async () => {
    await relay?.stop();
    await delivery?.stop();
    relay = undefined;
    delivery = undefined;
  });

  function startPipeline() {
    relay?.start();
    delivery?.start();
  }

  /**
   * Acme com ana (autora), bia e caio no projeto WEB e dani só na organização (não lê WEB).
   * Semeado direto: as tabelas são de outros contextos e o alvo aqui é o worker.
   */
  async function world() {
    const now = new Date();
    const person = async (name: string) => {
      const id = randomUUID();
      await prisma.user.create({
        data: {
          id,
          email: `${name}-${id.slice(0, 8)}@exemplo.com`,
          name: name === 'ana' ? 'Ana <b>Atacante</b>' : name,
          passwordHash: '$argon2id$fixture',
          emailVerifiedAt: now,
          passwordChangedAt: now,
          createdAt: now,
        },
      });
      return id;
    };
    const [ana, bia, caio, dani] = [
      await person('ana'),
      await person('bia'),
      await person('caio'),
      await person('dani'),
    ];
    const organizationId = randomUUID();
    const slug = `acme-${organizationId.slice(0, 8)}`;
    await prisma.organization.create({
      data: { id: organizationId, name: 'Acme Secreta', slug, createdAt: now },
    });
    for (const userId of [ana, bia, caio, dani]) {
      await prisma.membership.create({
        data: { id: randomUUID(), organizationId, userId, role: 'member', createdAt: now },
      });
    }
    const projectId = randomUUID();
    await prisma.project.create({
      data: {
        id: projectId,
        organizationId,
        key: 'WEB',
        name: 'Web',
        createdByUserId: ana,
        createdAt: now,
      },
    });
    for (const [userId, role] of [
      [ana, 'manager'],
      [bia, 'member'],
      [caio, 'member'],
    ] as const) {
      await prisma.projectMember.create({
        data: { id: randomUUID(), organizationId, projectId, userId, role, createdAt: now },
      });
    }
    const statusId = randomUUID();
    await prisma.workflowStatus.create({
      data: {
        id: statusId,
        organizationId,
        projectId,
        name: 'A fazer',
        category: 'todo',
        position: 0,
      },
    });
    const taskId = randomUUID();
    await prisma.task.create({
      data: {
        id: taskId,
        organizationId,
        projectId,
        number: 1,
        title: 'Título confidencial',
        statusId,
        createdByUserId: ana,
        createdAt: now,
        boardRank: 'e00001',
      },
    });
    const commentId = randomUUID();
    await prisma.comment.create({
      data: {
        id: commentId,
        organizationId,
        projectId,
        taskId,
        authorUserId: ana,
        body: `Segredo para <@${bia}> e <@${dani}>`,
        createdAt: now,
      },
    });
    for (const userId of [bia, dani]) {
      await prisma.commentMention.create({ data: { organizationId, commentId, userId } });
    }
    return { ana, bia, caio, dani, organizationId, slug, projectId, taskId, commentId };
  }

  type World = Awaited<ReturnType<typeof world>>;

  async function outbox(w: World) {
    const assignment = randomUUID();
    const mention = randomUUID();
    const base = {
      organizationId: w.organizationId,
      projectId: w.projectId,
      taskId: w.taskId,
      actorUserId: w.ana,
    };
    await prisma.outboxEvent.createMany({
      data: [
        {
          id: assignment,
          type: TasksIntegrationEventType.assigneeChanged,
          payload: { ...base, assigneeUserId: w.bia },
          occurredAt: new Date(),
        },
        {
          id: mention,
          type: CollaborationIntegrationEventType.mentionsAdded,
          payload: { ...base, commentId: w.commentId, userIds: [w.bia, w.dani] },
          occurredAt: new Date(),
        },
      ],
    });
    return { assignment, mention };
  }

  const recipients = async (organizationId: string) =>
    (
      await prisma.notification.findMany({
        where: { organizationId },
        select: { recipientUserId: true, kind: true },
      })
    )
      .map((row) => `${row.recipientUserId}|${row.kind}`)
      .sort();

  async function messagesTo(address: string): Promise<MailpitMessage[]> {
    const response = await fetch(`${mailpitApi()}/messages`);
    const list = (await response.json()) as { messages: MailpitSummary[] };
    const mine = list.messages.filter((message) => message.To.some((to) => to.Address === address));
    return Promise.all(
      mine.map(
        async (message) =>
          (await (await fetch(`${mailpitApi()}/message/${message.ID}`)).json()) as MailpitMessage,
      ),
    );
  }

  it('records the events written while the worker was stopped, once per recipient and never for the actor', async () => {
    const w = await world();
    await outbox(w);
    // Worker parado: nada é consumido; os eventos esperam na outbox.
    expect(await prisma.notification.count()).toBe(0);

    startPipeline();

    await vi.waitFor(
      async () => {
        expect(await recipients(w.organizationId)).toEqual(
          [`${w.bia}|assignment`, `${w.bia}|mention`, `${w.dani}|mention`].sort(),
        );
        expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
      },
      { timeout: 15_000, interval: 100 },
    );
  });

  it('is idempotent: a republished event (relay lost its commit) records nothing new', async () => {
    const w = await world();
    const events = await outbox(w);
    startPipeline();
    await vi.waitFor(async () => expect(await prisma.notification.count()).toBe(3), {
      timeout: 15_000,
      interval: 100,
    });
    const before = await prisma.notification.findMany({ orderBy: { id: 'asc' } });

    const outcome = await delivery?.processNotificationJob({
      data: {
        eventId: events.mention,
        type: CollaborationIntegrationEventType.mentionsAdded,
        occurredAt: new Date().toISOString(),
        payload: {
          organizationId: w.organizationId,
          projectId: w.projectId,
          taskId: w.taskId,
          commentId: w.commentId,
          actorUserId: w.ana,
          userIds: [w.bia, w.dani],
        },
      },
      attemptsMade: 0,
      // O processador só lê `data` e `attemptsMade`.
    } as unknown as Job<OutboxJobData>);

    expect(outcome).toEqual({ created: 0, duplicate: 2, ineligible: 0, capped: 0 });
    expect(await prisma.notification.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('a recipient who left the organization before processing is dropped (FK), not retried forever', async () => {
    const w = await world();
    await prisma.membership.deleteMany({ where: { userId: w.dani } });
    await outbox(w);

    startPipeline();

    await vi.waitFor(
      async () =>
        expect(await recipients(w.organizationId)).toEqual(
          [`${w.bia}|assignment`, `${w.bia}|mention`].sort(),
        ),
      { timeout: 15_000, interval: 100 },
    );
  });

  it('BR-034: the hourly plan sends one digest per person, without names nor content, and marks it', async () => {
    const w = await world();
    await outbox(w);
    startPipeline();
    await vi.waitFor(async () => expect(await prisma.notification.count()).toBe(3), {
      timeout: 15_000,
      interval: 100,
    });
    const biaEmail = (await prisma.user.findUniqueOrThrow({ where: { id: w.bia } })).email;
    const daniEmail = (await prisma.user.findUniqueOrThrow({ where: { id: w.dani } })).email;

    expect(await delivery?.planDigests()).toBe(2);
    // Planejar de novo na mesma hora (outro worker, retry do fan-out) não duplica o job.
    expect(await delivery?.planDigests()).toBe(2);
    expect(await delivery?.digestQueue.getJob(digestJobId(w.bia, new Date()))).toMatchObject({
      name: DIGEST_SEND_JOB_NAME,
    });

    await vi.waitFor(
      async () => {
        expect(
          await prisma.notification.count({ where: { emailedAt: null } }),
          'all candidates marked',
        ).toBe(0);
      },
      { timeout: 15_000, interval: 100 },
    );
    const [message, ...others] = await messagesTo(biaEmail);
    expect(others).toEqual([]);
    expect(message?.Subject).toBe(DIGEST_SUBJECT);
    expect(message?.Text).toContain(`Na organização ${w.slug}: 1 menção e 1 atribuição.`);
    expect(message?.Text).toContain(`WEB-1: ${APP_URL}/o/${w.slug}/projects/WEB/tasks/1`);
    for (const secret of ['Ana', 'Atacante', 'Título confidencial', 'Segredo', 'Acme Secreta']) {
      expect(message?.Text).not.toContain(secret);
      expect(message?.HTML).not.toContain(secret);
    }
    // dani não lê WEB: nada visível, nenhum e-mail, mas a candidata não volta no próximo resumo.
    expect(await messagesTo(daniEmail)).toEqual([]);
    expect(await delivery?.planDigests()).toBe(0);
  });

  it('retention: the daily purge removes notifications older than 90 days', async () => {
    const w = await world();
    const row = (occurredAt: Date) => ({
      id: randomUUID(),
      organizationId: w.organizationId,
      recipientUserId: w.bia,
      kind: 'assignment' as const,
      actorUserId: w.ana,
      projectId: w.projectId,
      taskId: w.taskId,
      dedupeKey: `assignment:${randomUUID()}`,
      sourceEventId: randomUUID(),
      occurredAt,
      createdAt: occurredAt,
    });
    const now = Date.now();
    const kept = row(new Date(now - 89 * DAY));
    await prisma.notification.createMany({ data: [row(new Date(now - 91 * DAY)), kept] });
    const maintenance = createMaintenance({
      prisma,
      redis,
      redisUrl,
      clock: new SystemClock(),
      logger: pino({ level: 'silent' }),
    });

    const report = await maintenance.purgeExpiredData();
    await maintenance.stop();

    expect(report.notifications).toBe(1);
    expect((await prisma.notification.findMany({ select: { id: true } })).map((r) => r.id)).toEqual(
      [kept.id],
    );
  });
});
