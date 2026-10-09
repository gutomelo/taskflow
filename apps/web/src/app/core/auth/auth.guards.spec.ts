import { TestBed } from '@angular/core/testing';
import {
  convertToParamMap,
  provideRouter,
  Router,
  UrlTree,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { AuthApi } from './auth-api';
import { authGuard, guestGuard } from './auth.guards';
import { AuthStore } from './auth.store';

const ana = {
  id: '01a11e1a-99fa-7501-a131-4ad99a122005',
  name: 'Ana',
  email: 'ana@exemplo.com',
  emailVerified: true,
};

describe('auth guards', () => {
  let store: AuthStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthApi, useValue: {} }],
    });
    store = TestBed.inject(AuthStore);
  });

  const serialize = (result: unknown) =>
    result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : result;

  function runAuthGuard(url: string) {
    return serialize(
      TestBed.runInInjectionContext(() =>
        authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
      ),
    );
  }

  function runGuestGuard(returnUrl?: string) {
    const route = {
      queryParamMap: convertToParamMap(returnUrl === undefined ? {} : { returnUrl }),
    } as ActivatedRouteSnapshot;
    return serialize(
      TestBed.runInInjectionContext(() => guestGuard(route, {} as RouterStateSnapshot)),
    );
  }

  it('lets authenticated users into protected pages', () => {
    store.signIn(ana);

    expect(runAuthGuard('/account/security')).toBe(true);
  });

  it('sends anonymous users to the login page, remembering where they were going', () => {
    store.endSession();

    expect(runAuthGuard('/account/security?tab=sessions')).toBe(
      '/login?returnUrl=%2Faccount%2Fsecurity%3Ftab%3Dsessions',
    );
  });

  it('does not carry the URL fragment (e-mail tokens) into the login query string', () => {
    store.endSession();

    expect(runAuthGuard('/verify-email#token=secret')).toBe('/login?returnUrl=%2Fverify-email');
  });

  it('lets anonymous visitors into guest pages', () => {
    store.endSession();

    expect(runGuestGuard('/account/security')).toBe(true);
  });

  it('sends signed-in users from guest pages to a safe return URL', () => {
    store.signIn(ana);

    expect(runGuestGuard('/account/security')).toBe('/account/security');
    expect(runGuestGuard('https://evil.example')).toBe('/');
    expect(runGuestGuard()).toBe('/');
  });
});
