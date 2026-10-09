import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

// Pré-requisito: PostgreSQL, Redis e Mailpit em execução (pnpm infra:up) e variáveis configuradas.
// A jornada CA-14 grava usuários: use um banco descartável (docs/development/testing.md).
const baseURL = process.env['BASE_URL'] ?? 'http://localhost:4200';
const isCI = Boolean(process.env['CI']);

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'pnpm exec nx run api:serve',
      url: 'http://localhost:3333/health/live',
      reuseExistingServer: !isCI,
      cwd: workspaceRoot,
      timeout: 120_000,
    },
    {
      // Worker: relay da outbox e envio de e-mails (jornada CA-14).
      command: 'pnpm exec nx run worker:serve',
      url: 'http://localhost:3334/health/live',
      reuseExistingServer: !isCI,
      cwd: workspaceRoot,
      timeout: 120_000,
    },
    {
      command: 'pnpm exec nx run web:serve',
      url: 'http://localhost:4200',
      reuseExistingServer: !isCI,
      cwd: workspaceRoot,
      timeout: 120_000,
    },
  ],
  // Chromium cobre a jornada de fumaça; outros navegadores entram com jornadas reais (Fase 1).
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
