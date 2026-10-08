import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import type { DependencyProbe } from '../health/dependency-probe';

export interface PrismaClientOptions {
  readonly databaseUrl: string;
}

export function createPrismaClient({ databaseUrl }: PrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

export function createPostgresProbe(prisma: PrismaClient): DependencyProbe {
  return {
    name: 'postgres',
    async check() {
      await prisma.$queryRaw`SELECT 1`;
    },
  };
}

export type { PrismaClient };
