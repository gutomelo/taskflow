import { TestBed } from '@angular/core/testing';
import { MyOrganizationsStore } from './my-organizations.store';
import { acme, ana, beta, MINE, settle, setupOrganizationsTesting } from './organizations.testing';

describe('MyOrganizationsStore', () => {
  function setup() {
    const env = setupOrganizationsTesting();
    return { ...env, store: TestBed.inject(MyOrganizationsStore) };
  }

  it('loads once and shares a request between concurrent callers', async () => {
    const { backend, store } = setup();

    const first = store.ensureLoaded();
    const second = store.ensureLoaded();
    backend.expectOne(MINE).flush({ items: [acme] });
    await Promise.all([first, second]);
    await store.ensureLoaded();

    expect(store.items()).toEqual([acme]);
    backend.verify();
  });

  it('CA-10: resolves a slug, reloading once before giving up (just accepted elsewhere)', async () => {
    const { backend, store } = setup();

    const resolving = store.resolve('beta');
    backend.expectOne(MINE).flush({ items: [acme] });
    await settle();
    backend.expectOne(MINE).flush({ items: [acme, beta] });

    expect(await resolving).toEqual(beta);
    const missing = store.resolve('gama');
    await settle();
    backend.expectOne(MINE).flush({ items: [acme, beta] });
    expect(await missing).toBeNull();
    backend.verify();
  });

  it('adds created organizations, invalidates on 404 and resets on session change', async () => {
    const { backend, store } = setup();
    const loading = store.ensureLoaded();
    backend.expectOne(MINE).flush({ items: [acme] });
    await loading;

    store.add(beta);
    expect(store.items()).toEqual([acme, beta]);
    store.invalidate();
    expect(store.status()).toBe('idle');
    store.reset();
    expect(store.items()).toEqual([]);
  });

  it('never builds a partial list: add() before loading leaves it to the server', async () => {
    const { backend, store } = setup();

    store.add(beta);
    expect(store.status()).toBe('idle');
    const loading = store.ensureLoaded();
    backend.expectOne(MINE).flush({ items: [acme, beta] });
    await loading;

    expect(store.items()).toEqual([acme, beta]);
    store.add({ ...beta, role: 'admin' });
    expect(store.items()).toEqual([acme, { ...beta, role: 'admin' }]);
  });

  it('keeps the load started right after sign-in when the session sync runs later', async () => {
    const { auth, backend, store } = setup();
    auth.signIn(ana);

    const loading = store.ensureLoaded();
    store.syncUser(ana.id);
    backend.expectOne(MINE).flush({ items: [acme] });
    await loading;

    expect(store.items()).toEqual([acme]);
  });

  it('discards a response that arrives after the session changed to someone else', async () => {
    const { auth, backend, store } = setup();
    auth.signIn(ana);

    const stale = store.ensureLoaded();
    store.syncUser('outra-pessoa');
    backend.expectOne(MINE).flush({ items: [acme] });
    await stale;

    expect(store.items()).toEqual([]);
    expect(store.status()).toBe('idle');
  });

  it('reports a failed load and lets the caller retry', async () => {
    const { backend, store } = setup();

    const failing = store.ensureLoaded();
    backend.expectOne(MINE).flush(null, { status: 503, statusText: 'Unavailable' });
    await expect(failing).rejects.toBeTruthy();
    expect(store.status()).toBe('error');

    const retry = store.reload();
    backend.expectOne(MINE).flush({ items: [beta] });
    await retry;
    expect(store.items()).toEqual([beta]);
  });

  it('rejects a response outside the contract', async () => {
    const { backend, store } = setup();

    const loading = store.ensureLoaded();
    backend.expectOne(MINE).flush({ items: [{ ...acme, role: 'superuser' }] });

    await expect(loading).rejects.toThrow('does not match the API contract');
  });
});
