import { ServiceBusyError } from '@taskflow/backend/shared/application';
import { ConcurrencyLimiter } from './concurrency-limiter';

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('ConcurrencyLimiter', () => {
  it('never runs more than the configured number of tasks at once', async () => {
    const limiter = new ConcurrencyLimiter('test', 2, 1_000);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
    };

    await Promise.all(Array.from({ length: 6 }, () => limiter.run(task)));

    expect(peak).toBe(2);
  });

  it('fails fast with ServiceBusyError when a slot does not free up in time', async () => {
    const limiter = new ConcurrencyLimiter('password-hasher', 1, 20);
    const blocker = deferred();
    const holding = limiter.run(() => blocker.promise);

    await expect(limiter.run(async () => 'never')).rejects.toBeInstanceOf(ServiceBusyError);

    blocker.resolve();
    await holding;
    await expect(limiter.run(async () => 'available again')).resolves.toBe('available again');
  });

  it('releases the slot when a task throws', async () => {
    const limiter = new ConcurrencyLimiter('test', 1, 50);

    await expect(limiter.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
  });
});
