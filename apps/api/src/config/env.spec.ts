import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { InvalidConfigurationError } from '@taskflow/backend/shared/infrastructure';
import { loadConfig } from './env';

const accessTokenSecret = 'k'.repeat(43);

const validEnvironment = {
  DATABASE_URL: 'postgresql://taskflow:secret-password@localhost:5432/taskflow',
  REDIS_URL: 'redis://localhost:6379',
  APP_ORIGIN: 'http://localhost:4200',
  AUTH_ACCESS_TOKEN_KEYS: JSON.stringify({ '2026-10': accessTokenSecret }),
  AUTH_ACCESS_TOKEN_ACTIVE_KID: '2026-10',
  CSRF_SECRET: 'c'.repeat(43),
  LOG_PSEUDONYMIZATION_KEY: 'l'.repeat(43),
};

describe('loadConfig', () => {
  it('applies defaults for optional variables', () => {
    const config = loadConfig(validEnvironment);

    expect(config).toMatchObject({
      environment: 'development',
      port: 3333,
      logLevel: 'info',
      healthCheckTimeoutMs: 2000,
      trustProxy: false,
      jsonBodyLimit: '100kb',
      passwordHashConcurrency: 4,
    });
  });

  it('parses numeric proxy trust and port', () => {
    const config = loadConfig({ ...validEnvironment, API_PORT: '8080', TRUST_PROXY: '1' });

    expect(config.port).toBe(8080);
    expect(config.trustProxy).toBe(1);
  });

  it('parses the access token key map and the active kid', () => {
    const config = loadConfig(validEnvironment);

    expect(config.accessTokenKeys).toEqual({ '2026-10': accessTokenSecret });
    expect(config.activeAccessTokenKid).toBe('2026-10');
  });

  it('lists every invalid variable without exposing received values', () => {
    const error = captureConfigurationError({
      ...validEnvironment,
      DATABASE_URL: undefined,
      REDIS_URL: 'http://not-redis:6379',
      API_PORT: 'not-a-number',
    });

    expect(variableNames(error)).toEqual(['API_PORT', 'DATABASE_URL', 'REDIS_URL']);
    expect(error.message).not.toContain('not-redis');
    expect(error.message).not.toContain('not-a-number');
  });

  it('never echoes secrets from connection strings', () => {
    const error = captureConfigurationError({
      ...validEnvironment,
      REDIS_URL: 'ftp://user:secret-password@host',
    });

    expect(error.message).not.toContain('secret-password');
  });

  describe('security secrets', () => {
    it('rejects secrets shorter than 32 bytes without echoing them', () => {
      const error = captureConfigurationError({
        ...validEnvironment,
        CSRF_SECRET: 'short-secret-value',
        AUTH_ACCESS_TOKEN_KEYS: JSON.stringify({ k1: 'tiny-signing-key' }),
        AUTH_ACCESS_TOKEN_ACTIVE_KID: 'k1',
      });

      expect(variableNames(error)).toEqual(['AUTH_ACCESS_TOKEN_KEYS', 'CSRF_SECRET']);
      expect(error.message).not.toContain('short-secret-value');
      expect(error.message).not.toContain('tiny-signing-key');
      expect(error.message).toContain('AUTH_ACCESS_TOKEN_KEYS.k1');
    });

    it('rejects a key map that is not valid JSON', () => {
      const error = captureConfigurationError({
        ...validEnvironment,
        AUTH_ACCESS_TOKEN_KEYS: '{not-json',
      });

      expect(variableNames(error)).toEqual(['AUTH_ACCESS_TOKEN_KEYS']);
    });

    it('requires the active kid to exist in the key map', () => {
      const error = captureConfigurationError({
        ...validEnvironment,
        AUTH_ACCESS_TOKEN_ACTIVE_KID: 'missing-kid',
      });

      expect(variableNames(error)).toEqual(['AUTH_ACCESS_TOKEN_ACTIVE_KID']);
    });

    it('rejects development placeholders in production', () => {
      const error = captureConfigurationError({
        ...validEnvironment,
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://app.taskflow.dev',
        CSRF_SECRET: `dev-only-${'x'.repeat(40)}`,
      });

      expect(variableNames(error)).toEqual(['CSRF_SECRET']);
    });

    it('accepts development placeholders outside production', () => {
      const config = loadConfig({
        ...validEnvironment,
        CSRF_SECRET: `dev-only-${'x'.repeat(40)}`,
      });

      expect(config.csrfSecret).toContain('dev-only');
    });
  });

  it('accepts the documented .env.example as a valid development configuration', () => {
    const examplePath = join(import.meta.dirname, '../../../../.env.example');
    const exampleEnvironment = parseEnv(readFileSync(examplePath, 'utf8'));

    expect(() => loadConfig(exampleEnvironment)).not.toThrow();
  });

  it('rejects the documented .env.example secrets in production', () => {
    const examplePath = join(import.meta.dirname, '../../../../.env.example');
    const exampleEnvironment = parseEnv(readFileSync(examplePath, 'utf8'));

    const error = captureConfigurationError({ ...exampleEnvironment, NODE_ENV: 'production' });

    expect(variableNames(error)).toEqual([
      'APP_ORIGIN',
      'AUTH_ACCESS_TOKEN_KEYS',
      'CSRF_SECRET',
      'LOG_PSEUDONYMIZATION_KEY',
    ]);
  });

  it('T29/B5: requires an https APP_ORIGIN in production only', () => {
    const productionSecrets = {
      ...validEnvironment,
      NODE_ENV: 'production',
      APP_ORIGIN: 'http://app.taskflow.dev',
    };
    expect(variableNames(captureConfigurationError(productionSecrets))).toEqual(['APP_ORIGIN']);
    expect(() =>
      loadConfig({ ...productionSecrets, APP_ORIGIN: 'https://app.taskflow.dev' }),
    ).not.toThrow();
  });

  it('requires APP_ORIGIN to be a bare origin', () => {
    const error = captureConfigurationError({
      ...validEnvironment,
      APP_ORIGIN: 'http://localhost:4200/app/',
    });

    expect(variableNames(error)).toEqual(['APP_ORIGIN']);
  });
});

/** Nome da variável de ambiente (o caminho pode incluir o kid, ex.: AUTH_ACCESS_TOKEN_KEYS.k1). */
function variableNames(error: InvalidConfigurationError): string[] {
  return [...new Set(error.invalidVariables.map(({ name }) => name.split('.')[0] ?? name))].sort();
}

function captureConfigurationError(environment: NodeJS.ProcessEnv): InvalidConfigurationError {
  try {
    loadConfig(environment);
  } catch (error) {
    if (error instanceof InvalidConfigurationError) return error;
    throw error;
  }
  throw new Error('Expected loadConfig to throw InvalidConfigurationError');
}
