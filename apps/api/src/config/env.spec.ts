import { InvalidConfigurationError, loadConfig } from './env';

const validEnvironment = {
  DATABASE_URL: 'postgresql://taskflow:secret-password@localhost:5432/taskflow',
  REDIS_URL: 'redis://localhost:6379',
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
    });
  });

  it('parses numeric proxy trust and port', () => {
    const config = loadConfig({ ...validEnvironment, API_PORT: '8080', TRUST_PROXY: '1' });

    expect(config.port).toBe(8080);
    expect(config.trustProxy).toBe(1);
  });

  it('lists every invalid variable without exposing received values', () => {
    const error = captureConfigurationError({
      REDIS_URL: 'http://not-redis:6379',
      API_PORT: 'not-a-number',
    });

    expect(error.invalidVariables.map(({ name }) => name).sort()).toEqual([
      'API_PORT',
      'DATABASE_URL',
      'REDIS_URL',
    ]);
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
});

function captureConfigurationError(environment: NodeJS.ProcessEnv): InvalidConfigurationError {
  try {
    loadConfig(environment);
  } catch (error) {
    if (error instanceof InvalidConfigurationError) return error;
    throw error;
  }
  throw new Error('Expected loadConfig to throw InvalidConfigurationError');
}
