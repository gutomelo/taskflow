import { Component } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthStore } from '../../core/auth';
import { sessionRefreshInterceptor } from '../../core/auth/session-refresh.interceptor';
import { WEB_LOCKS } from '../../core/auth/session-refresher';
import { LoginPage } from './login.page';
import { RegisterPage } from './register.page';

@Component({ template: 'destino' })
class Destination {}

/** Páginas reais com rotas, interceptor e backend simulado. */
export async function openAuthPage(url: string) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([sessionRefreshInterceptor])),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'login', component: LoginPage },
        { path: 'register', component: RegisterPage },
        { path: 'account/security', component: Destination },
        { path: '', component: Destination },
      ]),
      { provide: WEB_LOCKS, useValue: null },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return {
    harness,
    fixture: harness.fixture as ComponentFixture<unknown>,
    backend: TestBed.inject(HttpTestingController),
    store: TestBed.inject(AuthStore),
    router: TestBed.inject(Router),
  };
}

export type AuthPageEnv = Awaited<ReturnType<typeof openAuthPage>>;

export function root(env: AuthPageEnv): HTMLElement {
  return env.fixture.nativeElement as HTMLElement;
}

export function field(env: AuthPageEnv, label: string): HTMLInputElement {
  const input = [...root(env).querySelectorAll('input')].find(
    (candidate) => candidate.labels?.[0]?.textContent?.trim().replace(/\s*\*$/, '') === label,
  );
  if (!input) throw new Error(`No field labelled "${label}"`);
  return input;
}

export async function type(env: AuthPageEnv, label: string, value: string): Promise<void> {
  const input = field(env, label);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
  await env.fixture.whenStable();
}

export async function submit(env: AuthPageEnv): Promise<void> {
  root(env).querySelector('form')?.dispatchEvent(new Event('submit'));
  await env.fixture.whenStable();
}

export const settle = () => new Promise<void>((resolve) => setTimeout(resolve));

export const problem = (code: string, extra: object = {}) => ({
  type: 'about:blank',
  title: code,
  code,
  ...extra,
});
