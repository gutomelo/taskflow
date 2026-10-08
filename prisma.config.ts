import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// O Prisma 7 não carrega .env automaticamente. Em CI/produção as variáveis vêm do ambiente.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

// `prisma generate` não precisa de banco; comandos de migration exigem DATABASE_URL
// e falham com erro explícito do Prisma quando ela não está definida.
const databaseUrl = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
