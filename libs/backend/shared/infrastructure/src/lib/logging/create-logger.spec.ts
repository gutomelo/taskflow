import { createLogger } from './create-logger';

describe('createLogger', () => {
  it('tags records with the service and redacts credentials', async () => {
    const lines: string[] = [];
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        lines.push(chunk.toString());
        return true;
      });
    try {
      const logger = await createLogger({
        service: 'taskflow-test',
        environment: 'test',
        level: 'info',
      });
      logger.info(
        {
          req: { headers: { authorization: 'Bearer abc', cookie: '__Host-tf_at=xyz' } },
          body: { password: 'hunter2', refreshToken: 'rt-123' },
        },
        'request',
      );
      logger.flush();
    } finally {
      stdoutWrite.mockRestore();
    }

    const output = lines.join('');
    expect(JSON.parse(output.trim().split('\n').at(-1) ?? '{}')).toMatchObject({
      service: 'taskflow-test',
      msg: 'request',
    });
    for (const secret of ['Bearer abc', 'xyz', 'hunter2', 'rt-123']) {
      expect(output).not.toContain(secret);
    }
  });

  it('honours the configured level', async () => {
    const logger = await createLogger({
      service: 'taskflow-test',
      environment: 'test',
      level: 'warn',
    });

    expect(logger.isLevelEnabled('info')).toBe(false);
    expect(logger.isLevelEnabled('warn')).toBe(true);
  });
});
