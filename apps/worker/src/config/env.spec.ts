import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { InvalidConfigurationError } from '@taskflow/backend/shared/infrastructure';
import { loadWorkerConfig } from './env';

const validEnvironment = {
  DATABASE_URL: 'postgresql://taskflow:secret-password@localhost:5432/taskflow',
  REDIS_URL: 'redis://localhost:6379',
  APP_URL: 'http://localhost:4200',
  SMTP_URL: 'smtp://localhost:1025',
  EMAIL_FROM: 'TaskFlow <nao-responda@taskflow.local>',
};

describe('loadWorkerConfig', () => {
  it('applies defaults for optional variables', () => {
    expect(loadWorkerConfig(validEnvironment)).toEqual({
      environment: 'development',
      logLevel: 'info',
      databaseUrl: validEnvironment.DATABASE_URL,
      redisUrl: validEnvironment.REDIS_URL,
      healthCheckTimeoutMs: 2000,
      host: '0.0.0.0',
      port: 3334,
      appUrl: 'http://localhost:4200',
      smtpUrl: 'smtp://localhost:1025',
      emailFrom: 'TaskFlow <nao-responda@taskflow.local>',
    });
  });

  it('accepts the documented .env.example as a valid development configuration', () => {
    const examplePath = join(import.meta.dirname, '../../../../.env.example');
    const exampleEnvironment = parseEnv(readFileSync(examplePath, 'utf8'));

    expect(loadWorkerConfig(exampleEnvironment).port).toBe(3334);
  });

  it('reports every missing required variable without leaking values', () => {
    const error = captureConfigurationError({ DATABASE_URL: 'mysql://root:hunter2@db/taskflow' });

    expect(variableNames(error)).toEqual([
      'APP_URL',
      'DATABASE_URL',
      'EMAIL_FROM',
      'REDIS_URL',
      'SMTP_URL',
    ]);
    expect(error.message).not.toContain('hunter2');
  });

  it.each(['http://localhost:1025', 'not a url'])('rejects SMTP_URL %s', (smtpUrl) => {
    expect(
      variableNames(captureConfigurationError({ ...validEnvironment, SMTP_URL: smtpUrl })),
    ).toEqual(['SMTP_URL']);
  });

  it('accepts a bare sender address', () => {
    expect(
      loadWorkerConfig({ ...validEnvironment, EMAIL_FROM: 'bot@taskflow.dev' }).emailFrom,
    ).toBe('bot@taskflow.dev');
  });

  it.each([
    ['header injection', 'Bcc: victim@example.com\r\nFrom: TaskFlow <a@b.dev>'],
    ['missing address', 'TaskFlow'],
    ['unterminated bracket', 'TaskFlow <a@b.dev'],
  ])('rejects EMAIL_FROM with %s', (_case, emailFrom) => {
    expect(
      variableNames(captureConfigurationError({ ...validEnvironment, EMAIL_FROM: emailFrom })),
    ).toEqual(['EMAIL_FROM']);
  });

  it('requires APP_URL to be a bare origin', () => {
    const error = captureConfigurationError({
      ...validEnvironment,
      APP_URL: 'http://localhost:4200/app',
    });

    expect(variableNames(error)).toEqual(['APP_URL']);
  });

  it('requires https for APP_URL in production only', () => {
    const error = captureConfigurationError({ ...validEnvironment, NODE_ENV: 'production' });
    expect(variableNames(error)).toEqual(['APP_URL']);

    const config = loadWorkerConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
      APP_URL: 'https://app.taskflow.dev',
    });
    expect(config.appUrl).toBe('https://app.taskflow.dev');
  });
});

function variableNames(error: InvalidConfigurationError): string[] {
  return [...new Set(error.invalidVariables.map(({ name }) => name))].sort();
}

function captureConfigurationError(environment: NodeJS.ProcessEnv): InvalidConfigurationError {
  try {
    loadWorkerConfig(environment);
  } catch (error) {
    if (error instanceof InvalidConfigurationError) return error;
    throw error;
  }
  throw new Error('Expected loadWorkerConfig to throw InvalidConfigurationError');
}
