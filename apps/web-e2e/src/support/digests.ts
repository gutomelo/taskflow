import { Queue } from 'bullmq';

// Mesmo nome de fila e de job do worker (apps/worker/src/notification-delivery.ts). O resumo é
// horário: a jornada pede o planejamento agora, como o agendador faria no minuto zero.
const DIGEST_QUEUE_NAME = 'notification-digests';
const DIGEST_PLAN_JOB_NAME = 'notifications.plan_digests';

export async function planDigestsNow(): Promise<void> {
  const redisUrl = new URL(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
  const queue = new Queue(DIGEST_QUEUE_NAME, {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      db: Number(redisUrl.pathname.slice(1) || 0),
      ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
    },
  });
  try {
    await queue.add(DIGEST_PLAN_JOB_NAME, {});
  } finally {
    await queue.close();
  }
}
