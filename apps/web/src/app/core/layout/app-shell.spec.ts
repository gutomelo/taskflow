import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthStore } from '../auth';
import { sessionRefreshInterceptor } from '../auth/session-refresh.interceptor';
import { WEB_LOCKS } from '../auth/session-refresher';
import { AppShell } from './app-shell';

@Component({ template: '' })
class Blank {}

const ana = {
  id: '01a11e1a-99fa-7501-a131-4ad99a122005',
  name: 'Ana Souza',
  email: 'ana@exemplo.com',
  emailVerified: false,
};

describe('AppShell', () => {
  let fixture: ComponentFixture<AppShell>;
  let backend: HttpTestingController;
  let store: AuthStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([sessionRefreshInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: Blank }]),
        { provide: WEB_LOCKS, useValue: null },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
  });

  afterEach(() => backend.verify());

  async function render() {
    fixture = TestBed.createComponent(AppShell);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;
  const banner = () => element().querySelector('[data-testid="verification-banner"]');
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };

  it('shows neither account menu nor banner to anonymous visitors', async () => {
    store.endSession();
    await render();

    expect(element().querySelector('[aria-label^="Menu da conta"]')).toBeNull();
    expect(banner()).toBeNull();
  });

  it('shows the account menu to signed-in users', async () => {
    store.signIn({ ...ana, emailVerified: true });
    await render();
    await settle();

    expect(element().querySelector('[aria-label="Menu da conta de Ana Souza"]')).not.toBeNull();
    expect(banner()).toBeNull();
  });

  it('asks unverified users to confirm the e-mail and resends the link (BR-013)', async () => {
    store.signIn(ana);
    await render();

    expect(banner()?.textContent).toContain('ana@exemplo.com');
    [...element().querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Reenviar link'))
      ?.click();
    await fixture.whenStable();
    backend
      .expectOne({ method: 'POST', url: '/api/v1/auth/email-verification/resend' })
      .flush(null, { status: 202, statusText: 'Accepted' });
    await settle();

    expect(banner()?.textContent).toContain('um novo link chegará em instantes');
    expect(
      [...element().querySelectorAll('button')].some((b) =>
        b.textContent?.includes('Reenviar link'),
      ),
    ).toBe(false);
  });

  it('hides the banner as soon as the e-mail is confirmed', async () => {
    store.signIn(ana);
    await render();

    store.markEmailVerified();
    await fixture.whenStable();

    expect(banner()).toBeNull();
  });

  it('signs out through the menu, issues a new CSRF cookie and goes to the login page', async () => {
    store.signIn({ ...ana, emailVerified: true });
    await render();
    await settle();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');

    element()
      .querySelector<HTMLButtonElement>('[aria-label="Menu da conta de Ana Souza"]')
      ?.click();
    await settle();
    const signOut = [...document.querySelectorAll<HTMLButtonElement>('[mat-menu-item]')].find(
      (item) => item.textContent?.includes('Sair'),
    );
    signOut?.click();
    await settle();
    backend.expectOne({ method: 'POST', url: '/api/v1/auth/logout' }).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await settle();
    backend.expectOne('/api/v1/auth/csrf').flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(store.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('keeps the session and warns when signing out fails for network reasons', async () => {
    store.signIn({ ...ana, emailVerified: true });
    await render();
    await settle();

    element()
      .querySelector<HTMLButtonElement>('[aria-label="Menu da conta de Ana Souza"]')
      ?.click();
    await settle();
    [...document.querySelectorAll<HTMLButtonElement>('[mat-menu-item]')]
      .find((item) => item.textContent?.includes('Sair'))
      ?.click();
    await settle();
    backend.expectOne('/api/v1/auth/logout').error(new ProgressEvent('error'));
    await settle();

    expect(store.isAuthenticated()).toBe(true);
    expect(element().querySelector('[role="alert"]')?.textContent).toContain(
      'Não foi possível sair',
    );
  });
});
