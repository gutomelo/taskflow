import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../../../node_modules/.vite/libs/backend/notifications/application',
  resolve: { tsconfigPaths: true },
  test: {
    name: 'backend-notifications-application',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // Testes com containers rodam no target integration-test.
    exclude: ['**/*.integration.spec.ts', '**/node_modules/**'],
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reportsDirectory: '../../../../coverage/libs/backend/notifications/application',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/generated/**', 'src/main.ts', 'src/testing/**'],
    },
  },
});
