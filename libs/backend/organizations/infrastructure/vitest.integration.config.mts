import { defineConfig } from 'vitest/config';

// Testes de integração com dependências reais via Testcontainers (requer Docker).
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../../../node_modules/.vite/libs/backend/organizations/infrastructure-integration',
  resolve: { tsconfigPaths: true },
  test: {
    name: 'backend-organizations-infrastructure:integration',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    reporters: ['default'],
  },
});
