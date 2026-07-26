/**
 * PaySwap Protocol — Merchant Platform (v2) — OAuth2 Provider.
 *
 * OAuth2 authorisation-code flow provider. Merchants register OAuth
 * applications (`registerApp`) and receive a `clientId` + `clientSecret`.
 * Third-party apps then:
 *
 *   1. `authorize(clientId, redirectUri, scope, state)` → build the
 *      redirect URL with the authorisation code (short-lived, 10 min).
 *   2. `exchangeCode(code, clientId, clientSecret)` → exchange the code
 *      for an `{ accessToken, refreshToken, expiresIn }` tuple.
 *   3. `refreshToken(refreshToken)` → mint a new access + refresh token
 *      pair from a valid refresh token.
 *   4. `validateAccessToken(token)` → verify signature + expiry + scope,
 *      return `{ merchantId, scopes }`.
 *   5. `revokeToken(token)` → invalidate an access or refresh token.
 *
 * Tokens are JWT-like (HMAC-SHA256 signed):
 *
 *   `<base64url(header)>.<base64url(payload)>.<base64url(signature)>`
 *
 *   header    = { alg: 'HS256', typ: 'JWT' }
 *   payload   = { sub: merchantId, scope: 'a b c', exp: ts,
 *                 type: 'access' | 'refresh', jti: tokenId }
 *   signature = HMAC-SHA256(header + '.' + payload, signingSecret)
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `merchant.oauth_app_registered`  — on `registerApp`.
 *  - `merchant.oauth_code_issued`     — on `authorize`.
 *  - `merchant.oauth_token_issued`    — on `exchangeCode` / `refreshToken`.
 *  - `merchant.oauth_token_revoked`   — on `revokeToken`.
 *
 * The kernel is FROZEN — this module imports `createHmac`, `randomBytes`
 * from node's `crypto`, `uid`, `nowTs` from `@/kernel/support`, and
 * `eventEngine` from `@/kernel/event`.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { OAuthApp, OAuthAuthorizationCode, OAuthToken } from './types';

/** Authorisation code lifetime (10 minutes). */
const CODE_LIFETIME_MS = 10 * 60 * 1000;

/** Access token lifetime (1 hour). */
const ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/** Refresh token lifetime (30 days). */
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** Token type returned in `OAuthToken`. */
const TOKEN_TYPE = 'Bearer';

/** Per-process signing secret (random 32 bytes). */
const SIGNING_SECRET = randomBytes(32).toString('hex');

/** Parameters for `registerApp`. */
export interface RegisterAppParams {
  name: string;
  redirectUris: string[];
  scopes: string[];
}

/** Result of `validateAccessToken`. */
export interface AccessTokenValidation {
  merchantId: string;
  scopes: string[];
  expiresAt: number;
  tokenId: string;
}

/** Decoded JWT payload. */
interface TokenPayload {
  sub: string;            // merchantId
  scope: string;          // space-delimited scopes
  exp: number;            // expiry (epoch ms)
  type: 'access' | 'refresh';
  jti: string;            // token id
}

/**
 * OAuthService owns registered OAuth apps, outstanding authorisation
 * codes, issued tokens, and the JWT signing/verification logic.
 */
export class OAuthService {
  private apps = new Map<string, OAuthApp>();
  private appsByClientId = new Map<string, OAuthApp>();
  private codes = new Map<string, OAuthAuthorizationCode>();
  /** Revoked token IDs (jti). */
  private revokedTokens = new Set<string>();

  // ----------------------------------------------------------------- registerApp
  registerApp(merchantId: string, params: RegisterAppParams): OAuthApp {
    const clientId = uid('psk_client');
    const clientSecret = uid('psk_secret') + randomBytes(16).toString('hex');
    const app: OAuthApp = {
      id: uid('oapp'),
      merchantId,
      name: params.name,
      clientId,
      clientSecret,
      redirectUris: [...params.redirectUris],
      scopes: [...params.scopes],
      createdAt: nowTs(),
    };
    this.apps.set(app.id, app);
    this.appsByClientId.set(clientId, app);
    eventEngine.emit('merchant.oauth_app_registered', {
      merchantId,
      appId: app.id,
      name: app.name,
      clientId,
      redirectUris: app.redirectUris,
      scopes: app.scopes,
    });
    return app;
  }

  getApp(clientId: string): OAuthApp | undefined {
    return this.appsByClientId.get(clientId);
  }

  listApps(merchantId: string): OAuthApp[] {
    return [...this.apps.values()].filter((a) => a.merchantId === merchantId);
  }

  // -------------------------------------------------------------------- authorize
  /**
   * Build the redirect URL with a freshly-minted authorisation code.
   * Returns `null` if the app is unknown or the redirectUri is not in
   * the app's allowed list.
   */
  authorize(
    clientId: string,
    redirectUri: string,
    scope: string,
    state?: string,
  ): string | null {
    const app = this.appsByClientId.get(clientId);
    if (!app) return null;
    if (!app.redirectUris.includes(redirectUri)) return null;
    const now = nowTs();
    const code = uid('oac') + randomBytes(12).toString('hex');
    const authCode: OAuthAuthorizationCode = {
      code,
      clientId: app.clientId,
      merchantId: app.merchantId,
      redirectUri,
      scope,
      state,
      expiresAt: now + CODE_LIFETIME_MS,
      createdAt: now,
    };
    this.codes.set(code, authCode);
    eventEngine.emit('merchant.oauth_code_issued', {
      merchantId: app.merchantId,
      clientId,
      redirectUri,
      scope,
      state,
      expiresAt: authCode.expiresAt,
    });
    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (typeof state === 'string') url.searchParams.set('state', state);
    return url.toString();
  }

  // ------------------------------------------------------------------- exchangeCode
  /**
   * Exchange an authorisation code for an access + refresh token pair.
   * Returns `null` if the code is missing, expired, already used, or
   * the client credentials don't match.
   */
  exchangeCode(code: string, clientId: string, clientSecret: string): OAuthToken | null {
    const authCode = this.codes.get(code);
    if (!authCode) return null;
    if (authCode.clientId !== clientId) return null;
    const app = this.appsByClientId.get(clientId);
    if (!app) return null;
    // Constant-time secret comparison.
    if (!this.safeEqual(app.clientSecret, clientSecret)) return null;
    if (nowTs() > authCode.expiresAt) {
      this.codes.delete(code);
      return null;
    }
    // Authorisation codes are single-use.
    this.codes.delete(code);
    return this.mintTokenPair(app.merchantId, authCode.scope);
  }

  // ------------------------------------------------------------------ refreshToken
  /**
   * Exchange a refresh token for a new access + refresh token pair.
   * Returns `null` if the refresh token is invalid, expired, or revoked.
   */
  refreshToken(refreshToken: string): OAuthToken | null {
    const payload = this.verifyToken(refreshToken);
    if (!payload || payload.type !== 'refresh') return null;
    if (this.revokedTokens.has(payload.jti)) return null;
    // Revoke the old refresh token (rotation — prevents reuse).
    this.revokedTokens.add(payload.jti);
    return this.mintTokenPair(payload.sub, payload.scope);
  }

  // ----------------------------------------------------------------- revokeToken
  /**
   * Revoke an access or refresh token. Returns `true` if the token was
   * valid + revoked, `false` if it was already invalid/revoked.
   */
  revokeToken(token: string): boolean {
    const payload = this.verifyToken(token);
    if (!payload) return false;
    if (this.revokedTokens.has(payload.jti)) return false;
    this.revokedTokens.add(payload.jti);
    eventEngine.emit('merchant.oauth_token_revoked', {
      merchantId: payload.sub,
      tokenId: payload.jti,
      type: payload.type,
    });
    return true;
  }

  // ------------------------------------------------------------- validateAccessToken
  /**
   * Validate an access token. Returns the merchantId + scopes + expiry
   * if valid, `null` otherwise.
   */
  validateAccessToken(token: string): AccessTokenValidation | null {
    const payload = this.verifyToken(token);
    if (!payload || payload.type !== 'access') return null;
    if (this.revokedTokens.has(payload.jti)) return null;
    return {
      merchantId: payload.sub,
      scopes: payload.scope ? payload.scope.split(' ').filter(Boolean) : [],
      expiresAt: payload.exp,
      tokenId: payload.jti,
    };
  }

  all(): OAuthApp[] {
    return [...this.apps.values()];
  }

  // --------------------------------------------------------------------- reset
  reset(): void {
    this.apps.clear();
    this.appsByClientId.clear();
    this.codes.clear();
    this.revokedTokens.clear();
  }

  // --------------------------------------------------------------- internals
  /** Mint a new access + refresh token pair for a merchant. */
  private mintTokenPair(merchantId: string, scope: string): OAuthToken {
    const now = nowTs();
    const accessExp = now + ACCESS_TOKEN_LIFETIME_MS;
    const refreshExp = now + REFRESH_TOKEN_LIFETIME_MS;
    const accessToken = this.signToken({
      sub: merchantId,
      scope,
      exp: accessExp,
      type: 'access',
      jti: uid('oatk'),
    });
    const refreshToken = this.signToken({
      sub: merchantId,
      scope,
      exp: refreshExp,
      type: 'refresh',
      jti: uid('ortk'),
    });
    eventEngine.emit('merchant.oauth_token_issued', {
      merchantId,
      accessTokenId: accessToken,
      scope,
      accessExpiresAt: accessExp,
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_LIFETIME_MS / 1000,
      tokenType: TOKEN_TYPE,
      scope,
      merchantId,
    };
  }

  /** Sign a JWT-like token payload. */
  private signToken(payload: TokenPayload): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = this.base64Url(JSON.stringify(header));
    const payloadB64 = this.base64Url(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = createHmac('sha256', SIGNING_SECRET)
      .update(signingInput, 'utf8')
      .digest('base64url');
    return `${signingInput}.${signature}`;
  }

  /** Verify a JWT-like token's signature + expiry. Returns the payload. */
  private verifyToken(token: string): TokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signature] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const expected = createHmac('sha256', SIGNING_SECRET)
      .update(signingInput, 'utf8')
      .digest('base64url');
    if (!this.safeEqual(expected, signature)) return null;
    let payload: TokenPayload;
    try {
      payload = JSON.parse(this.base64UrlDecode(payloadB64)) as TokenPayload;
    } catch {
      return null;
    }
    if (typeof payload.exp !== 'number' || nowTs() > payload.exp) return null;
    return payload;
  }

  /** Constant-time string comparison. */
  private safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    } catch {
      return false;
    }
  }

  private base64Url(s: string): string {
    return Buffer.from(s, 'utf8').toString('base64url');
  }

  private base64UrlDecode(s: string): string {
    return Buffer.from(s, 'base64url').toString('utf8');
  }
}

// Singleton.
const _g = globalThis as unknown as { __PAYSWAP_OAUTH_SERVICE?: OAuthService };
export const oauthService: OAuthService = _g.__PAYSWAP_OAUTH_SERVICE ?? new OAuthService();
if (!_g.__PAYSWAP_OAUTH_SERVICE) _g.__PAYSWAP_OAUTH_SERVICE = oauthService;
