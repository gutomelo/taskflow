import type { Clock } from '@taskflow/backend/shared/kernel';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
