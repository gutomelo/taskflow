import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = join(import.meta.dirname, '../../../../../..');

export interface PostgresTestDatabase {
  readonly connectionUri: string;
  stop(): Promise<void>;
}

/**
 * Sobe um PostgreSQL efêmero (mesma versão do Compose) e aplica as migrations reais
 * com `prisma migrate deploy` — testes de integração validam o schema que vai para produção.
 */
export async function startPostgresTestDatabase(): Promise<PostgresTestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:18-alpine',
  ).start();
  const connectionUri = container.getConnectionUri();

  try {
    await execFileAsync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: WORKSPACE_ROOT,
      env: { ...process.env, DATABASE_URL: connectionUri },
    });
  } catch (error) {
    await container.stop();
    throw error;
  }

  return {
    connectionUri,
    stop: async () => {
      await container.stop();
    },
  };
}
