import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { EmailMessage, EmailSender } from '@taskflow/backend/shared/application';
import {
  createPrismaClient,
  createRedisClient,
  PrismaOutboxWriter,
  PrismaTransactionRunner,
  SmtpEmailSender,
  SystemClock,
  UuidV7Generator,
  type PrismaClient,
  type Redis,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import {
  EmailDeliveryThrottle,
  IdentityEventType,
  RegisterUserUseCase,
  RequestPasswordResetUseCase,
} from '@taskflow/backend/identity/application';
import {
  FakePasswordHasher,
  fakePseudonymizer,
  InMemoryRateLimiter,
} from '@taskflow/backend/identity/application/testing';
import {
  CryptoSecretTokenGenerator,
  PrismaUserRepository,
  PrismaUserTokenRepository,
} from '@taskflow/backend/identity/infrastructure';
import type { UserTokenPurpose } from '@taskflow/backend/identity/domain';
import { createEmailDelivery, type EmailDelivery } from './email-delivery';

const APP_URL = 'http://localhost:4200';
const PASSWORD = 'Correct-Horse-9-Battery';

type MailpitSummary = { ID: string; Subject: string; To: Array<{ Address: string }> };
type MailpitMessage = MailpitSummary & { Text: string; HTML: string };

/** SMTP real (Mailpit) com falhas sob comando, para exercitar o retry da fila. */
class FlakyEmailSender implements EmailSender {
  readonly attempted: EmailMessage[] = [];
  private failuresLeft = 0;
  constructor(private readonly inner: EmailSender) {}
  failNext(times = 1) {
    this.failuresLeft = times;
  }
  async send(message: EmailMessage) {
    this.attempted.push(message);
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error('SMTP temporarily unavailable');
    }
    await this.inner.send(message);
  }
}

describe('email delivery pipeline (integration: PostgreSQL + Redis + Mailpit)', () => {
  let database: PostgresTestDatabase;
  let redisContainer: StartedTestContainer;
  let mailpit: StartedTestContainer;
  let prisma: PrismaClient;
  let redis: Redis;
  let redisUrl: string;
  let smtp: SmtpEmailSender;
  let sender: FlakyEmailSender;
  let delivery: EmailDelivery | undefined;

  const transactions = () => new PrismaTransactionRunner(prisma);
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
    redis = createRedisClient({ redisUrl, connectionName: 'email-delivery-test' });
    await redis.connect();
    smtp = new SmtpEmailSender({
      smtpUrl: `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`,
      from: 'TaskFlow <nao-responda@taskflow.local>',
    });
  });

  afterAll(async () => {
    await delivery?.stop();
    smtp?.close();
    redis?.disconnect();
    await prisma?.$disconnect();
    await Promise.all([database?.stop(), redisContainer?.stop(), mailpit?.stop()]);
  });

  beforeEach(() => {
    sender = new FlakyEmailSender(smtp);
    delivery = createEmailDelivery({
      prisma,
      redis,
      redisUrl,
      emailSender: sender,
      appUrl: APP_URL,
      idGenerator: new UuidV7Generator(),
      clock: new SystemClock(),
      logger: pino({ level: 'silent' }),
      relayPollIntervalMs: 50,
      // Backoff curto: o retry acontece em milissegundos em vez de 5 s.
      jobOptions: { backoff: { type: 'fixed', delay: 100 } },
    });
  });

  afterEach(async () => {
    await delivery?.stop();
    delivery = undefined;
  });

  // Produtores reais da API; throttle novo a cada chamada (o limite por e-mail não é o alvo).
  const freshThrottle = () =>
    new EmailDeliveryThrottle(new InMemoryRateLimiter(), fakePseudonymizer);

  async function register(email: string, name = 'Ana <b>Teste</b>') {
    const runner = transactions();
    await new RegisterUserUseCase({
      users: new PrismaUserRepository(runner),
      passwordHasher: new FakePasswordHasher(),
      commonPasswords: { contains: () => false },
      emailThrottle: freshThrottle(),
      transactions: runner,
      outbox: new PrismaOutboxWriter(runner),
      idGenerator: new UuidV7Generator(),
      clock: new SystemClock(),
    }).execute({ name, email, password: PASSWORD });
  }

  async function requestPasswordReset(email: string) {
    const runner = transactions();
    await new RequestPasswordResetUseCase({
      emailThrottle: freshThrottle(),
      transactions: runner,
      outbox: new PrismaOutboxWriter(runner),
      idGenerator: new UuidV7Generator(),
      clock: new SystemClock(),
    }).execute({ email, client: { ipAddress: '203.0.113.10', userAgent: null } });
  }

  const uniqueEmail = () => `pessoa-${randomUUID()}@exemplo.com`;

  async function messagesTo(address: string): Promise<MailpitMessage[]> {
    const list = (await (await fetch(`${mailpitApi()}/messages?limit=500`)).json()) as {
      messages: MailpitSummary[];
    };
    const summaries = list.messages.filter((message) =>
      message.To.some((recipient) => recipient.Address === address),
    );
    return Promise.all(
      summaries.map(
        async (summary) =>
          (await (await fetch(`${mailpitApi()}/message/${summary.ID}`)).json()) as MailpitMessage,
      ),
    );
  }

  async function waitForMessages(address: string, count: number): Promise<MailpitMessage[]> {
    let messages: MailpitMessage[] = [];
    await vi.waitFor(
      async () => {
        messages = await messagesTo(address);
        expect(messages).toHaveLength(count);
      },
      { timeout: 15_000, interval: 100 },
    );
    return messages;
  }

  async function userIdOf(email: string): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    return user.id;
  }

  function tokenIn(text: string, path: string): string {
    const match = new RegExp(`${APP_URL}${path}#token=([A-Za-z0-9_-]+)`).exec(text);
    if (!match?.[1]) throw new Error(`No ${path} link in e-mail`);
    return match[1];
  }

  async function ownerOf(token: string, purpose: UserTokenPurpose) {
    return new PrismaUserTokenRepository(transactions()).findOwner(
      new CryptoSecretTokenGenerator().hash(token),
      purpose,
      new Date(),
    );
  }

  it('delivers the verification link of a new account to Mailpit (CA-01)', async () => {
    const email = uniqueEmail();
    delivery?.start();

    await register(email);

    const [message] = await waitForMessages(email, 1);
    expect(message?.Subject).toBe('Confirme seu e-mail no TaskFlow');
    // Conta não verificada: saudação genérica, sem o nome escolhido no cadastro.
    expect(message?.Text).toContain('Olá!');
    expect(`${message?.Text}${message?.HTML}`).not.toContain('Teste');
    const token = tokenIn(message?.Text ?? '', '/verify-email');
    expect(message?.HTML).toContain(`href="${APP_URL}/verify-email#token=${token}"`);
    expect(await ownerOf(token, 'email_verification')).toEqual({ userId: await userIdOf(email) });
  });

  it('retries after an SMTP failure with a new link; only the delivered link works', async () => {
    const email = uniqueEmail();
    sender.failNext();
    delivery?.start();

    await register(email);

    const [message] = await waitForMessages(email, 1);
    const delivered = tokenIn(message?.Text ?? '', '/verify-email');
    expect(sender.attempted).toHaveLength(2);
    const failed = tokenIn(sender.attempted[0]?.text ?? '', '/verify-email');
    expect(failed).not.toBe(delivered);
    expect(await ownerOf(failed, 'email_verification')).toBeNull();
    expect(await ownerOf(delivered, 'email_verification')).toEqual({
      userId: await userIdOf(email),
    });
  });

  it('delivers exactly once when the worker starts after the registration (CA-13)', async () => {
    const email = uniqueEmail();

    await register(email);
    const userId = await userIdOf(email);
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: {
        type: IdentityEventType.emailVerificationRequested,
        payload: { equals: { userId } },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await messagesTo(email)).toHaveLength(0);
    expect(event.publishedAt).toBeNull();

    delivery?.start();
    await waitForMessages(email, 1);

    // Republicação pelo relay (commit perdido): a fila ignora o mesmo jobId.
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: null } });
    await vi.waitFor(
      async () =>
        expect(
          (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).publishedAt,
        ).not.toBeNull(),
      { timeout: 5_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await messagesTo(email)).toHaveLength(1);

    // Reprocessar o mesmo evento não cria um segundo token.
    await delivery?.processEmailJob({
      data: {
        eventId: event.id,
        type: event.type,
        occurredAt: event.occurredAt.toISOString(),
        payload: event.payload,
      },
      attemptsMade: 0,
    } as Parameters<EmailDelivery['processEmailJob']>[0]); // só `data` e `attemptsMade` são lidos
    expect(await prisma.userToken.count({ where: { sourceEventId: event.id } })).toBe(1);
  });

  it('sends an informative notice, not a verification link, for an existing address (CA-02)', async () => {
    const email = uniqueEmail();
    delivery?.start();
    await register(email);
    await waitForMessages(email, 1);

    await register(email, 'Outra Pessoa');

    const messages = await waitForMessages(email, 2);
    const notice = messages.find(
      (message) => message.Subject !== 'Confirme seu e-mail no TaskFlow',
    );
    expect(notice?.Subject).toBe('Tentativa de cadastro com o seu e-mail');
    expect(`${notice?.Text}${notice?.HTML}`).not.toContain('token');
    expect(notice?.Text).toContain(`${APP_URL}/forgot-password`);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('sends a 30 min reset link to account owners and nothing to unknown addresses', async () => {
    const owner = uniqueEmail();
    const stranger = uniqueEmail();
    delivery?.start();
    await register(owner);
    await waitForMessages(owner, 1);

    await requestPasswordReset(owner);
    await requestPasswordReset(stranger);

    const messages = await waitForMessages(owner, 2);
    const reset = messages.find((message) => message.Subject === 'Redefina sua senha do TaskFlow');
    expect(reset?.Text).toContain('30 minutos');
    const token = tokenIn(reset?.Text ?? '', '/reset-password');
    expect(await ownerOf(token, 'password_reset')).toEqual({ userId: await userIdOf(owner) });

    const strangerEvent = await prisma.outboxEvent.findFirstOrThrow({
      where: { payload: { equals: { email: stranger } } },
    });
    await vi.waitFor(
      async () => {
        const job = await delivery?.queue.getJob(strangerEvent.id);
        expect(job?.returnvalue).toEqual({ status: 'discarded', reason: 'user_not_found' });
      },
      { timeout: 15_000, interval: 100 },
    );
    expect(await messagesTo(stranger)).toHaveLength(0);
  });
});
