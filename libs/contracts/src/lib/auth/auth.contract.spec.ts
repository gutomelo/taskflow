import { loginRequestSchema, registerRequestSchema, sessionSummarySchema } from './auth.contract';

describe('auth contracts', () => {
  it('rejects unknown fields in commands (mass assignment)', () => {
    expect(
      registerRequestSchema.safeParse({
        name: 'Ana',
        email: 'ana@exemplo.com',
        password: 'x',
        isAdmin: true,
      }).success,
    ).toBe(false);
  });

  it('bounds password size to protect the password hasher', () => {
    expect(
      loginRequestSchema.safeParse({ email: 'ana@exemplo.com', password: 'x'.repeat(1025) })
        .success,
    ).toBe(false);
    expect(
      loginRequestSchema.safeParse({ email: 'ana@exemplo.com', password: 'x'.repeat(1024) })
        .success,
    ).toBe(true);
  });

  it('describes sessions with ISO dates and a structured device', () => {
    expect(
      sessionSummarySchema.safeParse({
        id: '01920000-0000-7000-8000-000000000001',
        createdAt: '2026-10-08T12:00:00.000Z',
        lastUsedAt: '2026-10-08T12:00:00.000Z',
        device: { browser: 'Firefox', os: null },
        isCurrent: true,
      }).success,
    ).toBe(true);
  });
});
