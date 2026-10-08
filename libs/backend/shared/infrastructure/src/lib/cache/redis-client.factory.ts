import { once } from 'node:events';
import { Redis } from 'ioredis';
import type { DependencyProbe } from '../health/dependency-probe';

export interface RedisClientOptions {
  readonly redisUrl: string;
  readonly connectionName: string;
}

export function createRedisClient({ redisUrl, connectionName }: RedisClientOptions): Redis {
  return new Redis(redisUrl, {
    connectionName,
    // Conecta sob demanda: a API sobe mesmo com Redis fora, e o readiness reporta o problema.
    lazyConnect: true,
    // Falha rápido em vez de enfileirar comandos indefinidamente enquanto desconectado.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}

export function createRedisProbe(redis: Redis): DependencyProbe {
  return {
    name: 'redis',
    async check(signal) {
      if (redis.status === 'wait') {
        await redis.connect();
      } else if (redis.status !== 'ready') {
        // Conexão em andamento (ex.: verificações simultâneas logo após o start):
        // aguarda ficar pronta, liberando o listener se o chamador abortar.
        await once(redis, 'ready', { signal });
      }
      const reply = await redis.ping();
      if (reply !== 'PONG') {
        throw new Error(`Unexpected Redis PING reply: ${reply}`);
      }
    },
  };
}

export type { Redis };
