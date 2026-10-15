import { errors, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose';
import type { Clock } from '@taskflow/backend/shared/kernel';
import type {
  AccessTokenIssuer,
  AccessTokenSubject,
  AccessTokenVerifier,
  AccessTokenVerifyOptions,
  IssuedAccessToken,
} from '@taskflow/backend/identity/application';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ISSUER = 'taskflow-api';
const AUDIENCE = 'taskflow-web';
const ALGORITHM = 'HS256';

export interface JoseAccessTokensOptions {
  /** Mapa fixo `kid → segredo` (≥ 32 bytes). Inclui a chave anterior durante a rotação. */
  readonly keys: Readonly<Record<string, string>>;
  readonly activeKid: string;
  readonly clock: Clock;
}

/**
 * Access token JWT HS256 de 15 min (ADR 0005). Verificação estrita: algoritmo fixo,
 * `kid` obrigatório e presente no mapa, `iss`/`aud` conferidos, 5 s de tolerância de relógio.
 */
export class JoseAccessTokens implements AccessTokenIssuer, AccessTokenVerifier {
  private readonly secrets: ReadonlyMap<string, Uint8Array>;

  constructor(private readonly options: JoseAccessTokensOptions) {
    const encoder = new TextEncoder();
    this.secrets = new Map(
      Object.entries(options.keys).map(([kid, secret]) => [kid, encoder.encode(secret)]),
    );
    if (!this.secrets.has(options.activeKid)) {
      throw new Error('Active access token kid is not present in the key map');
    }
  }

  async issue({ userId, sessionId }: AccessTokenSubject): Promise<IssuedAccessToken> {
    const issuedAtSeconds = Math.floor(this.options.clock.now().getTime() / 1000);
    const expiresAtSeconds = issuedAtSeconds + ACCESS_TOKEN_TTL_SECONDS;
    const secret = this.secrets.get(this.options.activeKid);
    if (!secret) throw new Error('Active access token key is missing');

    const token = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: ALGORITHM, kid: this.options.activeKid, typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAtSeconds)
      .setExpirationTime(expiresAtSeconds)
      .sign(secret);

    return { token, expiresAt: new Date(expiresAtSeconds * 1000) };
  }

  async verify(
    token: string,
    options: AccessTokenVerifyOptions = {},
  ): Promise<AccessTokenSubject | null> {
    const getKey: JWTVerifyGetKey = (header) => {
      const secret = header.kid ? this.secrets.get(header.kid) : undefined;
      if (!secret) throw new errors.JWKSNoMatchingKey();
      return secret;
    };

    try {
      const { payload } = await jwtVerify(token, getKey, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience: AUDIENCE,
        clockTolerance: 5,
        currentDate: this.options.clock.now(),
        requiredClaims: ['sub', 'sid', 'exp', 'iat'],
      });
      return toSubject(payload);
    } catch (error) {
      // A jose valida assinatura, algoritmo, iss e aud antes de `exp`: o payload de um
      // JWTExpired já é autêntico. Apenas a expiração pode ser relevada, e só se pedido.
      if (options.ignoreExpiration && error instanceof errors.JWTExpired) {
        return toSubject(error.payload);
      }
      return null;
    }
  }
}

function toSubject(payload: {
  sub?: unknown;
  [claim: string]: unknown;
}): AccessTokenSubject | null {
  const sessionId = payload['sid'];
  if (typeof payload.sub !== 'string' || typeof sessionId !== 'string') return null;
  return { userId: payload.sub, sessionId };
}
