import {
  HttpClient,
  HttpXsrfTokenExtractor,
  provideHttpClient,
  withInterceptors,
  withXsrfConfiguration,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { sessionRefreshInterceptor } from './session-refresh.interceptor';
import { WEB_LOCKS } from './session-refresher';

/** Ambiente de teste com o interceptor real e o backend simulado pelo HttpTestingController. */
/** Cookie CSRF simulado (jsdom não aceita cookies `__Host-` em http). */
export const csrfCookie = { value: 'csrf-1' as string | null };

export function setupAuthTesting() {
  csrfCookie.value = 'csrf-1';
  TestBed.configureTestingModule({
    providers: [
      // Mesma ordem de produção: o interceptor de XSRF do Angular roda antes do nosso.
      provideHttpClient(
        withXsrfConfiguration({ cookieName: '__Host-tf_csrf', headerName: 'X-CSRF-Token' }),
        withInterceptors([sessionRefreshInterceptor]),
      ),
      { provide: HttpXsrfTokenExtractor, useValue: { getToken: () => csrfCookie.value } },
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: WEB_LOCKS, useValue: null },
    ],
  });
  const router = TestBed.inject(Router);
  return {
    http: TestBed.inject(HttpClient),
    backend: TestBed.inject(HttpTestingController),
    store: TestBed.inject(AuthStore),
    router,
    navigate: vi.spyOn(router, 'navigate').mockResolvedValue(true),
  };
}

/** Deixa promessas e observables encadeados avançarem até a próxima requisição pendente. */
export const settle = () => new Promise<void>((resolve) => setTimeout(resolve));

export const problem = (code: string) => ({ type: 'about:blank', code, title: code });

export const ana = {
  id: '01a11e1a-99fa-7501-a131-4ad99a122005',
  name: 'Ana',
  email: 'ana@exemplo.com',
  emailVerified: true,
};
