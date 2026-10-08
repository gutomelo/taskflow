import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ReadinessReport } from '@taskflow/contracts';
import { SystemStatusPage } from './system-status.page';

describe('SystemStatusPage', () => {
  let fixture: ComponentFixture<SystemStatusPage>;
  let httpTesting: HttpTestingController;

  const readyReport: ReadinessReport = {
    status: 'ready',
    checks: [
      { name: 'postgres', status: 'up', latencyMs: 4 },
      { name: 'redis', status: 'up', latencyMs: 1 },
    ],
  };

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SystemStatusPage);
    fixture.autoDetectChanges();
    TestBed.tick();
  });

  afterEach(() => httpTesting.verify());

  it('shows a loading skeleton while the readiness check is pending', () => {
    httpTesting.expectOne('/health/ready');

    const skeleton = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="status-skeleton"]',
    );
    expect(skeleton).not.toBeNull();
    expect(text()).toContain('Verificando serviços');
  });

  it('lists every dependency as operational when the API is ready', async () => {
    httpTesting.expectOne('/health/ready').flush(readyReport);
    await settle();

    expect(text()).toContain('Todos os serviços estão operacionais.');
    expect(text()).toContain('Banco de dados (PostgreSQL)');
    expect(text()).toContain('Cache e filas (Redis)');
    expect(text()).not.toContain('Indisponível');
  });

  it('shows a degraded state with the failing dependency when the API answers 503', async () => {
    const degraded: ReadinessReport = {
      status: 'not_ready',
      checks: [
        { name: 'postgres', status: 'up', latencyMs: 4 },
        { name: 'redis', status: 'down', latencyMs: 2000 },
      ],
    };

    httpTesting
      .expectOne('/health/ready')
      .flush(degraded, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    expect(text()).toContain('Alguns serviços estão indisponíveis');
    expect(text()).toContain('Indisponível');
    expect(text()).toContain('Tentar novamente');
  });

  it('shows an alert and retries when the API cannot be reached', async () => {
    httpTesting
      .expectOne('/health/ready')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await settle();

    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Não foi possível contatar a API');

    alert?.querySelector('button')?.click();
    TestBed.tick();
    httpTesting.expectOne('/health/ready').flush(readyReport);
    await settle();

    expect(text()).toContain('Todos os serviços estão operacionais.');
  });
});
