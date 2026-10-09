import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { toApiProblem } from './api-problem';

describe('toApiProblem', () => {
  it('reads code, violations and Retry-After from a Problem Details response', () => {
    const error = new HttpErrorResponse({
      status: 422,
      headers: new HttpHeaders({ 'Retry-After': '30' }),
      error: {
        type: 'about:blank',
        title: 'A senha não atende aos requisitos',
        status: 422,
        code: 'PASSWORD_POLICY_VIOLATION',
        violations: [{ field: 'password', message: 'symbol' }],
      },
    });

    expect(toApiProblem(error)).toEqual({
      status: 422,
      code: 'PASSWORD_POLICY_VIOLATION',
      violations: [{ field: 'password', message: 'symbol' }],
      retryAfterSeconds: 30,
    });
  });

  it('does not trust bodies that are not Problem Details', () => {
    const error = new HttpErrorResponse({ status: 502, error: '<html>Bad Gateway</html>' });

    expect(toApiProblem(error)).toEqual({
      status: 502,
      code: null,
      violations: [],
      retryAfterSeconds: null,
    });
  });

  it('treats non-HTTP failures as no response', () => {
    expect(toApiProblem(new Error('Timeout has occurred')).status).toBe(0);
  });
});
