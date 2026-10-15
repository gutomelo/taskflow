import { SignJWT } from 'jose';
import type { Clock } from '@taskflow/backend/shared/kernel';
import { ACCESS_TOKEN_TTL_SECONDS, JoseAccessTokens } from './jose-access-tokens';

const CURRENT_SECRET = 'c'.repeat(43);
const PREVIOUS_SECRET = 'p'.repeat(43);
const T0 = new Date('2026-10-08T12:00:00.000Z');
const subject = { userId: 'user-1', sessionId: 'session-1' };

function controllableClock(start = T0) {
  let now = start;
  const clock: Clock = { now: () => now };
  return {
    clock,
    advanceSeconds: (seconds: number) => (now = new Date(now.getTime() + seconds * 1000)),
  };
}

function tokens(
  clock: Clock,
  keys: Record<string, string> = { current: CURRENT_SECRET },
  activeKid = 'current',
) {
  return new JoseAccessTokens({ keys, activeKid, clock });
}

/** Assina um token arbitrário para simular atacantes ou emissões antigas. */
function forge(options: {
  secret?: string;
  kid?: string;
  alg?: string;
  audience?: string;
  expiresAt?: number;
}) {
  const issuedAt = Math.floor(T0.getTime() / 1000);
  return new SignJWT({ sid: 'session-1' })
    .setProtectedHeader({ alg: options.alg ?? 'HS256', kid: options.kid ?? 'current' })
    .setSubject('user-1')
    .setIssuer('taskflow-api')
    .setAudience(options.audience ?? 'taskflow-web')
    .setIssuedAt(issuedAt)
    .setExpirationTime(options.expiresAt ?? issuedAt + 900)
    .sign(new TextEncoder().encode(options.secret ?? CURRENT_SECRET));
}

describe('JoseAccessTokens', () => {
  it('issues a 15-minute HS256 token carrying only the user and session ids', async () => {
    const { clock } = controllableClock();
    const issued = await tokens(clock).issue(subject);
    const [header, payload] = issued.token
      .split('.')
      .slice(0, 2)
      .map((part) => JSON.parse(Buffer.from(part, 'base64url').toString()));

    expect(issued.expiresAt).toEqual(new Date(T0.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000));
    expect(header).toEqual({ alg: 'HS256', kid: 'current', typ: 'JWT' });
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub']);
    expect(await tokens(clock).verify(issued.token)).toEqual(subject);
  });

  it('rejects tokens after expiration, tolerating 5 s of clock skew', async () => {
    const { clock, advanceSeconds } = controllableClock();
    const issuer = tokens(clock);
    const { token } = await issuer.issue(subject);

    advanceSeconds(ACCESS_TOKEN_TTL_SECONDS + 4);
    expect(await issuer.verify(token)).toEqual(subject);
    advanceSeconds(2);
    expect(await issuer.verify(token)).toBeNull();
  });

  it('can ignore expiration on request, still requiring a valid signature', async () => {
    const { clock, advanceSeconds } = controllableClock();
    const issuer = tokens(clock);
    const { token } = await issuer.issue(subject);
    advanceSeconds(ACCESS_TOKEN_TTL_SECONDS * 10);

    expect(await issuer.verify(token, { ignoreExpiration: true })).toEqual(subject);
    expect(
      await issuer.verify(await forge({ secret: 'x'.repeat(43), expiresAt: 1 }), {
        ignoreExpiration: true,
      }),
    ).toBeNull();
  });

  it('never relaxes audience or issuer checks when ignoring expiration', async () => {
    const { clock } = controllableClock(new Date('2027-01-01T00:00:00.000Z'));
    const expiredWrongAudience = await forge({ audience: 'other-app' });

    expect(await tokens(clock).verify(expiredWrongAudience, { ignoreExpiration: true })).toBeNull();
  });

  it.each([
    [
      'a tampered payload',
      async (token: string) => {
        const [header, , signature] = token.split('.');
        const evil = Buffer.from(JSON.stringify({ sub: 'admin', sid: 'x' })).toString('base64url');
        return `${header}.${evil}.${signature}`;
      },
    ],
    [
      'an unsigned alg=none token',
      async () => {
        const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'current' })).toString(
          'base64url',
        );
        const payload = Buffer.from(
          JSON.stringify({
            sub: 'user-1',
            sid: 'session-1',
            iss: 'taskflow-api',
            aud: 'taskflow-web',
          }),
        ).toString('base64url');
        return `${header}.${payload}.`;
      },
    ],
    ['a token signed with another secret', async () => forge({ secret: 'x'.repeat(43) })],
    ['a token with an unknown kid', async () => forge({ kid: 'unknown' })],
    ['a token with another HMAC algorithm', async () => forge({ alg: 'HS512' })],
    ['a token for another audience', async () => forge({ audience: 'other-app' })],
    ['garbage', async () => 'not.a.jwt'],
  ])('rejects %s', async (_case, build) => {
    const { clock } = controllableClock();
    const valid = (await tokens(clock).issue(subject)).token;

    expect(await tokens(clock).verify(await build(valid))).toBeNull();
  });

  it('supports key rotation: tokens from the previous kid stay valid while the key is listed', async () => {
    const { clock } = controllableClock();
    const oldIssuer = tokens(clock, { previous: PREVIOUS_SECRET }, 'previous');
    const { token } = await oldIssuer.issue(subject);

    const rotated = tokens(clock, { current: CURRENT_SECRET, previous: PREVIOUS_SECRET });
    expect(await rotated.verify(token)).toEqual(subject);
    expect((await rotated.issue(subject)).token.split('.')[0]).toBe(
      Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'current', typ: 'JWT' })).toString(
        'base64url',
      ),
    );

    const retired = tokens(clock, { current: CURRENT_SECRET });
    expect(await retired.verify(token)).toBeNull();
  });

  it('refuses to start when the active kid has no key', () => {
    const { clock } = controllableClock();
    expect(() => tokens(clock, { current: CURRENT_SECRET }, 'missing')).toThrow('kid');
  });
});
