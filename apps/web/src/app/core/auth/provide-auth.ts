import {
  type HttpInterceptorFn,
  provideHttpClient,
  withFetch,
  withInterceptors,
  withXsrfConfiguration,
} from '@angular/common/http';
import { inject, provideAppInitializer, type EnvironmentProviders } from '@angular/core';
import { AuthStore } from './auth.store';
import { sessionRefreshInterceptor } from './session-refresh.interceptor';

/**
 * HttpClient com CSRF double-submit (ADR 0005), renovação de sessão e bootstrap do `/me`.
 * `outerInterceptors` rodam por fora da renovação: veem o resultado final de cada chamada.
 */
export function provideAuth(
  options: { readonly outerInterceptors?: ReadonlyArray<HttpInterceptorFn> } = {},
): EnvironmentProviders[] {
  return [
    provideHttpClient(
      withFetch(),
      withXsrfConfiguration({ cookieName: '__Host-tf_csrf', headerName: 'X-CSRF-Token' }),
      withInterceptors([...(options.outerInterceptors ?? []), sessionRefreshInterceptor]),
    ),
    provideAppInitializer(() => inject(AuthStore).bootstrap()),
  ];
}
