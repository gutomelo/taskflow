import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { NotificationDto, NotificationPage } from '@taskflow/contracts';
import {
  acme,
  ana,
  MINE,
  nextRequest,
  settle,
  setupOrganizationsTesting,
} from '../../core/organizations/organizations.testing';
import { NotificationPreferencesPage } from '../account/notification-preferences.page';
import { organizationsRoutes } from '../organizations/organizations.routes';
import { taskLink } from './notifications.page';
import { UNREAD_POLL_MS } from './unread-notifications.store';

const BASE = `/api/v1/organizations/${acme.id}/notifications`;
const COUNT = `${BASE}/unread-count`;
const PREFERENCES = '/api/v1/me/notification-preferences';
const uuid = (suffix: string) => `0192a000-0000-7000-8000-${suffix.padStart(12, '0')}`;

function notification(suffix: string, overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: uuid(`e${suffix}`),
    kind: 'assignment',
    actor: { userId: uuid('a1'), name: 'Mia' },
    task: { id: uuid(`7${suffix}`), key: `WEB-${suffix}`, title: `Tarefa ${suffix}` },
    commentId: null,
    occurredAt: '2026-10-15T10:00:00.000Z',
    readAt: null,
    ...overrides,
  };
}

async function openArea(path: string) {
  const env = setupOrganizationsTesting(organizationsRoutes);
  env.auth.signIn(ana);
  const harness = await RouterTestingHarness.create();
  const navigation = harness.navigateByUrl(`/o/acme${path}`);
  (await nextRequest(env.backend, MINE)).flush({ items: [acme] });
  await navigation;
  const stable = async () => {
    await settle();
    await harness.fixture.whenStable();
  };
  return { ...env, harness, stable, root: () => harness.fixture.nativeElement as HTMLElement };
}

type Env = Awaited<ReturnType<typeof openArea>>;

const bell = (env: Env) =>
  env.root().querySelector<HTMLAnchorElement>('a[href="/o/acme/notifications"]');
const announcement = (env: Env) =>
  env.root().querySelector('[data-testid="notification-announcement"]')?.textContent?.trim();
const rows = (env: Env) =>
  [...env.root().querySelectorAll('ul li a[href*="/tasks/"]')].map(
    (row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  );
const buttonNamed = (env: Env, name: string) =>
  [...env.root().querySelectorAll('button')].find((button) => button.textContent?.trim() === name);
const pendingCounts = (env: Env) => env.backend.match(COUNT);

describe('notification bell (spec 008, CA-09, RNF-06)', () => {
  afterEach(() => {
    vi.useRealTimers();
    TestBed.inject(Router).dispose();
  });

  it('CA-09: shows the unread count with an accessible name; the badge itself is hidden', async () => {
    const env = await openArea('');
    (await nextRequest(env.backend, COUNT)).flush({ count: 2, capped: false });
    await env.stable();

    expect(bell(env)?.getAttribute('aria-label')).toBe('Notificações, 2 não lidas');
    const badge = env.root().querySelector('[data-testid="notification-badge"]');
    expect(badge?.textContent?.trim()).toBe('2');
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
  });

  it('saturates at "99+" and has a plain name with nothing unread', async () => {
    const env = await openArea('');
    (await nextRequest(env.backend, COUNT)).flush({ count: 99, capped: true });
    await env.stable();
    expect(bell(env)?.getAttribute('aria-label')).toBe('Notificações, mais de 99 não lidas');
    expect(
      env.root().querySelector('[data-testid="notification-badge"]')?.textContent?.trim(),
    ).toBe('99+');
  });

  it('polls every 60 s while visible, announces an increase and keeps the last value on failure', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const env = await openArea('');
    (await nextRequest(env.backend, COUNT)).flush({ count: 0, capped: false });
    await env.stable();
    expect(bell(env)?.getAttribute('aria-label')).toBe('Notificações');
    expect(announcement(env)).toBe('');

    vi.advanceTimersByTime(UNREAD_POLL_MS);
    (await nextRequest(env.backend, COUNT)).flush({ count: 1, capped: false });
    await env.stable();
    await vi.waitFor(() => expect(announcement(env)).toBe('Nova notificação: 1 não lida.'));

    vi.advanceTimersByTime(UNREAD_POLL_MS);
    (await nextRequest(env.backend, COUNT)).flush(null, { status: 503, statusText: 'Down' });
    await env.stable();
    expect(bell(env)?.getAttribute('aria-label')).toBe('Notificações, 1 não lida');
  });

  it('announces the same increase again after a drop (the live region text changes)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const env = await openArea('');
    (await nextRequest(env.backend, COUNT)).flush({ count: 1, capped: false });
    await env.stable();
    const region = env.root().querySelector('[data-testid="notification-announcement"]');
    const texts: string[] = [];
    const observer = new MutationObserver(() => texts.push(region?.textContent?.trim() ?? ''));
    if (region) observer.observe(region, { childList: true, characterData: true, subtree: true });

    // Consultas a 60 s de distância: cada anúncio termina antes da próxima.
    for (const count of [2, 1, 2]) {
      vi.advanceTimersByTime(UNREAD_POLL_MS);
      (await nextRequest(env.backend, COUNT)).flush({ count, capped: false });
      await env.stable();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await env.stable();
    }
    await vi.waitFor(() =>
      expect(texts.filter((text) => text === 'Novas notificações: 2 não lidas.')).toHaveLength(2),
    );
    observer.disconnect();
  });

  it('pauses with the tab hidden and checks again when it comes back', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const env = await openArea('');
    (await nextRequest(env.backend, COUNT)).flush({ count: 0, capped: false });
    await env.stable();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(3 * UNREAD_POLL_MS);
    await settle();
    expect(pendingCounts(env)).toEqual([]);

    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    (await nextRequest(env.backend, COUNT)).flush({ count: 3, capped: false });
    await env.stable();
    expect(bell(env)?.getAttribute('aria-label')).toBe('Notificações, 3 não lidas');
    hidden.mockRestore();
  });
});

describe('notifications page (spec 008, RF-04, RF-06, CA-09)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  async function openPage(first: NotificationPage, unread = 2) {
    const env = await openArea('/notifications');
    (await nextRequest(env.backend, COUNT)).flush({ count: unread, capped: false });
    (await nextRequest(env.backend, BASE)).flush(first);
    await env.stable();
    return env;
  }

  it('lists actor (or "Ex-membro"), phrase, key and title, unread first-class; empty state', async () => {
    const env = await openPage({
      items: [
        notification('2', { kind: 'mention', commentId: uuid('c1') }),
        notification('1', {
          actor: { userId: uuid('a2'), name: null },
          readAt: '2026-10-15T11:00:00.000Z',
        }),
      ],
      nextCursor: null,
    });

    expect(rows(env)).toEqual([
      expect.stringContaining('não lida: Mia mencionou você em WEB-2 Tarefa 2'),
      expect.stringContaining('Ex-membro atribuiu a você WEB-1 Tarefa 1'),
    ]);
    expect(rows(env)[1]).not.toContain('não lida');
    expect(buttonNamed(env, 'Carregar mais')).toBeUndefined();
  });

  it('shows the empty state', async () => {
    const env = await openPage({ items: [], nextCursor: null }, 0);
    expect(env.root().textContent).toContain('Nenhuma notificação por aqui.');
    expect(buttonNamed(env, 'Marcar todas como lidas')).toBeUndefined();
  });

  it('CA-09: opening one marks it read and goes to the task', async () => {
    const env = await openPage({ items: [notification('7')], nextCursor: null }, 1);

    env.root().querySelector<HTMLAnchorElement>('ul li a[href*="/tasks/"]')?.click();
    const read = await nextRequest(env.backend, `${BASE}/${uuid('e7')}/read`);
    expect(read.request.method).toBe('POST');
    read.flush(null, { status: 204, statusText: 'No Content' });
    await env.stable();

    expect(TestBed.inject(Router).url).toBe('/o/acme/projects/WEB/tasks/7');
    expect(bell(env)?.getAttribute('aria-label')).toBe('Notificações');
  });

  it('a stale count answered after opening one neither restores it nor announces anything', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const env = await openPage({ items: [notification('7'), notification('6')], nextCursor: null });
    vi.advanceTimersByTime(UNREAD_POLL_MS);
    const stale = await nextRequest(env.backend, COUNT);

    const first = env.root().querySelector<HTMLAnchorElement>('ul li a[href*="/tasks/"]');
    first?.addEventListener('click', (event) => event.preventDefault(), { capture: true });
    first?.click();
    first?.click();
    await env.stable();
    stale.flush({ count: 2, capped: false });
    await env.stable();

    expect(env.backend.match(`${BASE}/${uuid('e7')}/read`)).toHaveLength(1);
    expect(bell(env)?.getAttribute('aria-label')).toBe('Notificações, 1 não lida');
    expect(announcement(env)).toBe('');
    vi.useRealTimers();
  });

  it('loads more (short pages are fine) and marks all up to the newest shown', async () => {
    const env = await openPage({ items: [notification('3')], nextCursor: 'c-2' });

    buttonNamed(env, 'Carregar mais')?.click();
    (await nextRequest(env.backend, `${BASE}?cursor=c-2`)).flush({
      items: [notification('1')],
      nextCursor: null,
    });
    await env.stable();
    expect(rows(env)).toHaveLength(2);
    expect(buttonNamed(env, 'Carregar mais')).toBeUndefined();

    buttonNamed(env, 'Marcar todas como lidas')?.click();
    const all = await nextRequest(env.backend, `${BASE}/read-all`);
    expect(all.request.body).toEqual({ upToId: uuid('e3') });
    all.flush(null, { status: 204, statusText: 'No Content' });
    (await nextRequest(env.backend, COUNT)).flush({ count: 0, capped: false });
    await env.stable();

    expect(rows(env).some((row) => row.includes('não lida'))).toBe(false);
    expect(env.root().textContent).toContain('Notificações marcadas como lidas.');
  });

  it('shows the error state with a retry', async () => {
    const env = await openArea('/notifications');
    (await nextRequest(env.backend, COUNT)).flush({ count: 0, capped: false });
    (await nextRequest(env.backend, BASE)).flush(null, { status: 500, statusText: 'Error' });
    await env.stable();
    expect(env.root().textContent).toContain('Não foi possível carregar as notificações.');

    buttonNamed(env, 'Tentar de novo')?.click();
    (await nextRequest(env.backend, BASE)).flush({ items: [notification('1')], nextCursor: null });
    await env.stable();
    expect(rows(env)).toHaveLength(1);
  });

  it('builds the task link from the key, even with dashes in the project key', () => {
    expect(taskLink('WEB-12')).toEqual(['..', 'projects', 'WEB', 'tasks', '12']);
    expect(taskLink('A-B-3')).toEqual(['..', 'projects', 'A-B', 'tasks', '3']);
  });
});

describe('notification preferences page (spec 008, RF-09, CA-09)', () => {
  function render() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(NotificationPreferencesPage);
    const backend = TestBed.inject(HttpTestingController);
    const root = fixture.nativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await fixture.whenStable();
    };
    const toggle = () => root.querySelector<HTMLInputElement>('input[role="switch"]');
    return { fixture, backend, root, stable, toggle };
  }

  it('CA-09: loads the preference and turns the email digest off', async () => {
    const { backend, root, stable, toggle } = render();
    await stable();
    backend.expectOne(PREFERENCES).flush({ emailDigest: true });
    await stable();
    expect(toggle()?.checked).toBe(true);
    expect(root.textContent).toContain('Receber resumo por e-mail');

    const input = toggle();
    if (!input) throw new Error('switch not found');
    input.checked = false;
    input.dispatchEvent(new Event('change'));
    const put = backend.expectOne({ method: 'PUT', url: PREFERENCES });
    expect(put.request.body).toEqual({ emailDigest: false });
    put.flush({ emailDigest: false });
    await stable();

    expect(toggle()?.checked).toBe(false);
    expect(root.textContent).toContain('Resumo por e-mail desligado.');
    backend.verify();
  });

  it('reverts the switch when saving fails', async () => {
    const { backend, root, stable, toggle } = render();
    await stable();
    backend.expectOne(PREFERENCES).flush({ emailDigest: true });
    await stable();

    const input = toggle();
    if (!input) throw new Error('switch not found');
    input.checked = false;
    input.dispatchEvent(new Event('change'));
    backend
      .expectOne({ method: 'PUT', url: PREFERENCES })
      .flush(null, { status: 500, statusText: 'Error' });
    await stable();

    expect(toggle()?.checked).toBe(true);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'Não foi possível salvar a preferência.',
    );
  });
});
