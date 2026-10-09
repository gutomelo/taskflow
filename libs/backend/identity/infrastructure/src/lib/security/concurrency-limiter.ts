import { ServiceBusyError } from '@taskflow/backend/shared/application';

/**
 * Semáforo com fila de espera limitada no tempo. Protege recursos caros (Argon2: ~19 MiB de
 * memória por hash) contra esgotamento: excedida a espera, falha rápido com `ServiceBusyError`.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly resource: string,
    private readonly maxConcurrent: number,
    private readonly maxWaitMs: number,
  ) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        this.active += 1;
        resolve();
      };
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(grant);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new ServiceBusyError(this.resource, Math.max(1, Math.ceil(this.maxWaitMs / 1000))));
      }, this.maxWaitMs);
      this.waiting.push(grant);
    });
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}
