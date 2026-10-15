import { z } from 'zod';
import { baseEnvironmentShape, InvalidConfigurationError, parseEnvironment } from './environment';

const schema = z.object({ ...baseEnvironmentShape, TOKEN: z.string().min(32) });

describe('parseEnvironment', () => {
  it('returns the parsed variables with defaults applied', () => {
    const variables = parseEnvironment(schema, {
      DATABASE_URL: 'postgresql://localhost:5432/taskflow',
      REDIS_URL: 'redis://localhost:6379',
      TOKEN: 't'.repeat(32),
    });

    expect(variables).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      HEALTH_CHECK_TIMEOUT_MS: 2000,
    });
  });

  it('lists every invalid variable without echoing the received values', () => {
    let captured: unknown;
    try {
      parseEnvironment(schema, {
        DATABASE_URL: 'mysql://root:hunter2@localhost/taskflow',
        TOKEN: 'short-secret-value',
      });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(InvalidConfigurationError);
    const error = captured as InvalidConfigurationError; // garantido pela asserção acima
    expect(error.invalidVariables.map(({ name }) => name).sort()).toEqual([
      'DATABASE_URL',
      'REDIS_URL',
      'TOKEN',
    ]);
    expect(error.message).not.toContain('hunter2');
    expect(error.message).not.toContain('short-secret-value');
  });
});
