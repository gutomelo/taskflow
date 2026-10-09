import { UnrecoverableError, type Job } from 'bullmq';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  IdentityEventType,
  type EmailDeliveryOutcome,
  type SendAccountNoticeUseCase,
  type SendEmailVerificationUseCase,
  type SendPasswordResetUseCase,
} from '@taskflow/backend/identity/application';
import type { OutboxJobData } from '@taskflow/backend/shared/infrastructure';

const userPayload = z.object({ userId: z.uuid() });

// Fronteira: o job vem do Redis; nada é usado sem validar o envelope e o payload do tipo.
const emailJobSchema = z.discriminatedUnion('type', [
  z.object({
    eventId: z.uuid(),
    type: z.literal(IdentityEventType.emailVerificationRequested),
    payload: userPayload,
  }),
  z.object({
    eventId: z.uuid(),
    type: z.literal(IdentityEventType.accountAlreadyExistsNotice),
    payload: userPayload,
  }),
  z.object({
    eventId: z.uuid(),
    type: z.literal(IdentityEventType.passwordResetRequested),
    occurredAt: z.iso.datetime(),
    payload: z.object({ email: z.string().min(3).max(254) }),
  }),
  z.object({
    eventId: z.uuid(),
    type: z.literal(IdentityEventType.passwordChangedNotice),
    payload: userPayload,
  }),
]);

export interface EmailJobUseCases {
  readonly sendEmailVerification: SendEmailVerificationUseCase;
  readonly sendPasswordReset: SendPasswordResetUseCase;
  readonly sendAccountNotice: SendAccountNoticeUseCase;
}

/**
 * Processa um job da fila `emails`: valida, despacha para o caso de uso do tipo e registra o
 * resultado com `eventId` como correlação. Job inválido não tem retry (`UnrecoverableError`);
 * falha de envio propaga para o retry com backoff da fila.
 */
export function createEmailJobProcessor(useCases: EmailJobUseCases, logger: Logger) {
  return async (job: Job<OutboxJobData>): Promise<EmailDeliveryOutcome> => {
    const parsed = emailJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(
        `Invalid email job: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
      );
    }

    const outcome = await dispatch(parsed.data, useCases);
    logger.info(
      {
        eventId: parsed.data.eventId,
        type: parsed.data.type,
        attempt: job.attemptsMade + 1,
        outcome,
      },
      'Email job processed',
    );
    return outcome;
  };
}

function dispatch(
  job: z.infer<typeof emailJobSchema>,
  { sendEmailVerification, sendPasswordReset, sendAccountNotice }: EmailJobUseCases,
): Promise<EmailDeliveryOutcome> {
  switch (job.type) {
    case IdentityEventType.emailVerificationRequested:
      return sendEmailVerification.execute({ eventId: job.eventId, userId: job.payload.userId });
    case IdentityEventType.passwordResetRequested:
      return sendPasswordReset.execute({
        eventId: job.eventId,
        email: job.payload.email,
        occurredAt: new Date(job.occurredAt),
      });
    case IdentityEventType.accountAlreadyExistsNotice:
      return sendAccountNotice.execute({
        userId: job.payload.userId,
        notice: 'account_already_exists',
      });
    case IdentityEventType.passwordChangedNotice:
      return sendAccountNotice.execute({ userId: job.payload.userId, notice: 'password_changed' });
  }
}

/**
 * Resumo da falha para log. Erros com `code` (SMTP/rede) podem trazer endereços na mensagem
 * (ex.: destinatário recusado), então só `name`/`code`/`responseCode` são registrados.
 */
export function describeJobError(error: unknown): Record<string, unknown> {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    const responseCode = 'responseCode' in error ? error.responseCode : undefined;
    return { errorName: error.name, errorCode: error.code, responseCode };
  }
  return { err: error };
}
