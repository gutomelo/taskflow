import { createHmac } from 'node:crypto';
import type { Pseudonymizer } from '@taskflow/backend/shared/application';

/** HMAC-SHA-256 com `LOG_PSEUDONYMIZATION_KEY` (≥ 32 bytes, validada no carregamento da config). */
export class HmacPseudonymizer implements Pseudonymizer {
  constructor(private readonly key: string) {}

  pseudonymize(value: string): string {
    return createHmac('sha256', this.key).update(value).digest('base64url');
  }
}
