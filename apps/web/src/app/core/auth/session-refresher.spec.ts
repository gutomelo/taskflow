import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { AuthApi } from './auth-api';
import { SESSION_REFRESH_LOCK, SessionRefresher, WEB_LOCKS } from './session-refresher';

/** LockManager mínimo e fiel: callbacks com o mesmo nome rodam um de cada vez. */
class FakeLockManager {
  readonly requested: string[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    this.requested.push(name);
    const run = this.tail.then(callback);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const problem = (status: number, code?: string) =>
  new HttpErrorResponse({ status, error: code ? { code } : null });

describe('SessionRefresher', () => {
  let refreshSession: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let locks: FakeLockManager | null;

  function setup(): SessionRefresher {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthApi, useValue: { refreshSession } },
        { provide: WEB_LOCKS, useValue: locks },
      ],
    });
    return TestBed.inject(SessionRefresher);
  }

  beforeEach(() => {
    refreshSession = vi.fn<() => Promise<void>>();
    locks = new FakeLockManager();
  });

  it('shares one in-flight refresh between concurrent callers in the same tab', async () => {
    const pending = deferred();
    refreshSession.mockReturnValue(pending.promise);
    const refresher = setup();

    const outcomes = Promise.all([refresher.refresh(), refresher.refresh(), refresher.refresh()]);
    pending.resolve();

    expect(await outcomes).toEqual(['refreshed', 'refreshed', 'refreshed']);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('runs the refresh inside the cross-tab Web Lock', async () => {
    refreshSession.mockResolvedValue(undefined);
    const refresher = setup();

    await refresher.refresh();

    expect(locks?.requested).toEqual([SESSION_REFRESH_LOCK]);
  });

  it('serializes refreshes across tabs: the second starts only after the first finishes', async () => {
    const first = deferred();
    refreshSession.mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined);
    const shared = new FakeLockManager();
    locks = shared;
    const tabA = setup();
    // Outra aba: outra instância do serviço, mesmo LockManager (mesma origem).
    const tabB = TestBed.runInInjectionContext(() => new SessionRefresher());

    const refreshA = tabA.refresh();
    const refreshB = tabB.refresh();
    await Promise.resolve();
    expect(refreshSession).toHaveBeenCalledTimes(1);

    first.resolve();
    expect(await Promise.all([refreshA, refreshB])).toEqual(['refreshed', 'refreshed']);
    expect(refreshSession).toHaveBeenCalledTimes(2);
  });

  it('starts a new refresh once the previous one has settled', async () => {
    refreshSession.mockResolvedValue(undefined);
    const refresher = setup();

    await refresher.refresh();
    await refresher.refresh();

    expect(refreshSession).toHaveBeenCalledTimes(2);
  });

  it('works without the Web Locks API', async () => {
    locks = null;
    refreshSession.mockResolvedValue(undefined);

    expect(await setup().refresh()).toBe('refreshed');
  });

  it.each([
    [
      '409 REFRESH_IN_PROGRESS (another request already rotated)',
      problem(409, 'REFRESH_IN_PROGRESS'),
      'refreshed',
    ],
    ['401 SESSION_REVOKED', problem(401, 'SESSION_REVOKED'), 'session_ended'],
    ['401 SESSION_EXPIRED', problem(401, 'SESSION_EXPIRED'), 'session_ended'],
    ['409 with another code', problem(409, 'VERSION_CONFLICT'), 'unavailable'],
    ['network failure', problem(0), 'unavailable'],
    ['server error', problem(503), 'unavailable'],
    ['timeout', new Error('Timeout has occurred'), 'unavailable'],
  ])('classifies %s', async (_case, error, outcome) => {
    refreshSession.mockRejectedValue(error);

    expect(await setup().refresh()).toBe(outcome);
  });
});
