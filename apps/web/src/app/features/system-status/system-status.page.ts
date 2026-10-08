import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { MatButton } from '@angular/material/button';
import type { DependencyCheck, ReadinessReport } from '@taskflow/contracts';
import { systemStatusMessages } from './system-status.messages';

type SystemStatus = 'loading' | 'ready' | 'degraded' | 'unavailable';

// O corpo de um 503 traz o relatório; validamos a forma antes de confiar nele.
function isReadinessReport(value: unknown): value is ReadinessReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'checks' in value &&
    Array.isArray(value.checks)
  );
}

@Component({
  selector: 'tf-system-status-page',
  imports: [MatButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './system-status.page.html',
})
export class SystemStatusPage {
  protected readonly messages = systemStatusMessages;
  protected readonly readiness = httpResource<ReadinessReport>(() => '/health/ready');

  private readonly report = computed<ReadinessReport | undefined>(() => {
    if (this.readiness.hasValue()) {
      return this.readiness.value();
    }
    const error = this.readiness.error();
    if (error instanceof HttpErrorResponse && isReadinessReport(error.error)) {
      return error.error;
    }
    return undefined;
  });

  protected readonly status = computed<SystemStatus>(() => {
    if (this.readiness.isLoading()) return 'loading';
    const report = this.report();
    if (!report) return 'unavailable';
    return report.status === 'ready' ? 'ready' : 'degraded';
  });

  protected readonly checks = computed<ReadonlyArray<DependencyCheck>>(
    () => this.report()?.checks ?? [],
  );

  protected dependencyLabel(name: string): string {
    return this.messages.dependencyLabels[name] ?? name;
  }

  protected retry(): void {
    this.readiness.reload();
  }
}
