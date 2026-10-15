import { DomainError } from '@taskflow/backend/shared/kernel';
import { RefreshInProgressError, SessionExpiredError, SessionRevokedError } from './session-errors';

describe('session errors', () => {
  it.each([
    [new SessionRevokedError(), 'SESSION_REVOKED'],
    [new SessionExpiredError(), 'SESSION_EXPIRED'],
    [new RefreshInProgressError(), 'REFRESH_IN_PROGRESS'],
  ])('%o keeps the stable code used by the HTTP mapping', (error, code) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe(code);
  });
});
