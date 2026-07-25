/**
 * PaySwap Protocol — Security — JWT Issuance + Rotation (HS256).
 *
 * Compact JWT (JWS) implementation using ONLY Node built-in `crypto`.
 * Algorithm: HMAC-SHA256 (HS256). Header includes a `kid` (key ID) so
 * verifiers can pick the correct secret during rotation overlap.
 *
 * Rotation model:
 *   - `sign()` always signs with the CURRENT secret.
 *   - `verify()` tries CURRENT secret first; if signature mismatch, tries
 *     PREVIOUS secret (graceful overlap window). After `previousExpiresAt`,
 *     the previous secret is dropped.
 *   - `rotateSigningSecret()` demotes current → previous + generates new current.
 *   - Emits `security.jwt_rotated` kernel event with old/new kid.
 *
 * Token TTL:
 *   - Access token: 1 hour (default).
 *   - Refresh token: 30 days (default).
 *
 * Frozen-kernel compliance: imports only `eventEngine` + `uid` (read-only).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eventEngine } from '@/kernel/event';
import { uid } from '@/kernel/support';
import { logger } from '@/protocol/ops/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JWTHeader {
  alg: 'HS256';
  typ: 'JWT';
  /** Key ID — identifies which signing secret was used. */
  kid: string;
}

export interface JWTPayload {
  /** Subject — user or merchant ID. */
  sub: string;
  /** Issuer — always 'payswap'. */
  iss: 'payswap';
  /** Audience — e.g. 'payswap-api', 'payswap-dashboard'. */
  aud: string;
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). */
  exp: number;
  /** Scopes granted to this token. */
  scope: string[];
  /** Role of the subject. */
  role: string;
  /** Merchant ID (if the subject belongs to a merchant account). */
  merchantId?: string;
  /** JWT ID — unique per token (for revocation / audit). */
  jti: string;
  /** Token type — 'access' or 'refresh'. */
  typ?: 'access' | 'refresh';
}

export interface JWTVerifyResult {
  valid: boolean;
  payload?: JWTPayload;
  /** Error code if invalid: 'malformed' | 'expired' | 'audience' | 'issuer' | 'signature'. */
  error?: string;
  /** Which kid verified the token (for rotation debugging). */
  verifiedByKid?: string;
}

export interface JWTSignOptions {
  /** TTL in seconds (default 3600 = 1h). */
  ttlSeconds?: number;
  /** Token type (default 'access'). */
  typ?: 'access' | 'refresh';
}

interface SigningSecret {
  /** 32-byte secret (base64). */
  secret: string;
  /** Key ID. */
  kid: string;
  /** When this secret was promoted to current (epoch ms). */
  promotedAt: number;
}

interface PreviousSecret extends SigningSecret {
  /** When the previous secret should stop being accepted (epoch ms). */
  expiresAt: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_ACCESS_TTL = 3600; // 1 hour
const DEFAULT_REFRESH_TTL = 30 * 24 * 3600; // 30 days
const ROTATION_OVERLAP_MS = 24 * 3600 * 1000; // 24h overlap

/** Base64url encoding (no padding). */
function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Base64url decoding. */
function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

/** Constant-time HMAC comparison. */
function safeHmacEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** HMAC-SHA256 signature over `data` with `secret`. */
function hs256(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data, 'utf8').digest();
}

/** Generate a new 32-byte random signing secret + kid. */
function newSigningSecret(): SigningSecret {
  return {
    secret: randomBytes(32).toString('base64'),
    kid: uid('jwtkey'),
    promotedAt: Date.now(),
  };
}

// ─── JWTService ──────────────────────────────────────────────────────────────

export class JWTService {
  private current: SigningSecret;
  private previous: PreviousSecret | undefined;

  constructor(initialSecret?: string) {
    if (initialSecret) {
      this.current = {
        secret: initialSecret,
        kid: uid('jwtkey'),
        promotedAt: Date.now(),
      };
    } else {
      this.current = newSigningSecret();
    }
  }

  /** Sign a payload with the current secret. Returns the compact JWT string. */
  sign(payload: Omit<JWTPayload, 'iat' | 'exp' | 'iss' | 'jti'>, opts: JWTSignOptions = {}): string {
    const ttl = opts.ttlSeconds ?? (opts.typ === 'refresh' ? DEFAULT_REFRESH_TTL : DEFAULT_ACCESS_TTL);
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JWTPayload = {
      ...payload,
      iss: 'payswap',
      iat: now,
      exp: now + ttl,
      jti: uid('jwt'),
      typ: opts.typ ?? 'access',
    };
    const header: JWTHeader = { alg: 'HS256', typ: 'JWT', kid: this.current.kid };
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(fullPayload));
    const signingInput = `${headerB64}.${payloadB64}`;
    const sig = hs256(signingInput, this.current.secret);
    return `${signingInput}.${base64url(sig)}`;
  }

  /** Verify a JWT's signature + claims. Tries current + previous secrets for
   *  graceful rotation overlap. Never throws — returns `{ valid: false, error }`. */
  verify(token: string, expectedAudience?: string): JWTVerifyResult {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'malformed' };
    }
    const [headerB64, payloadB64, sigB64] = parts;
    let header: JWTHeader;
    let payload: JWTPayload;
    try {
      header = JSON.parse(base64urlDecode(headerB64).toString('utf8')) as JWTHeader;
      payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8')) as JWTPayload;
    } catch {
      return { valid: false, error: 'malformed' };
    }
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return { valid: false, error: 'malformed' };
    }
    // Drop previous if overlap window expired.
    this.maybeDropPrevious();
    const signingInput = `${headerB64}.${payloadB64}`;
    const givenSig = base64urlDecode(sigB64);
    // Try current.
    const currentSig = hs256(signingInput, this.current.secret);
    if (safeHmacEqual(givenSig, currentSig)) {
      return this.validateClaims(payload, this.current.kid, expectedAudience);
    }
    // Try previous (rotation overlap).
    if (this.previous) {
      const prevSig = hs256(signingInput, this.previous.secret);
      if (safeHmacEqual(givenSig, prevSig)) {
        return this.validateClaims(payload, this.previous.kid, expectedAudience);
      }
    }
    return { valid: false, error: 'signature' };
  }

  /** Decode a JWT without verifying (for inspection / kid lookup). */
  decode(token: string): { header?: JWTHeader; payload?: JWTPayload; error?: string } {
    const parts = token.split('.');
    if (parts.length !== 3) return { error: 'malformed' };
    try {
      const header = JSON.parse(base64urlDecode(parts[0]).toString('utf8')) as JWTHeader;
      const payload = JSON.parse(base64urlDecode(parts[1]).toString('utf8')) as JWTPayload;
      return { header, payload };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Rotate the signing secret. Current demotes to previous (still valid for
   *  verification during the overlap window). Emits `security.jwt_rotated`. */
  rotateSigningSecret(): { oldKid: string; newKid: string } {
    const oldKid = this.current.kid;
    this.previous = {
      ...this.current,
      expiresAt: Date.now() + ROTATION_OVERLAP_MS,
    };
    this.current = newSigningSecret();
    eventEngine.emit('security.jwt_rotated', {
      oldKid,
      newKid: this.current.kid,
      previousExpiresAt: this.previous.expiresAt,
      rotatedAt: Date.now(),
    }, 0);
    logger.info('JWT signing secret rotated', {
      oldKid,
      newKid: this.current.kid,
      overlapMs: ROTATION_OVERLAP_MS,
    });
    return { oldKid, newKid: this.current.kid };
  }

  /** Current key ID (for external exposure in a JWKS-like endpoint). */
  currentKid(): string {
    return this.current.kid;
  }

  /** Whether a previous secret is still in the overlap window. */
  hasPrevious(): boolean {
    this.maybeDropPrevious();
    return this.previous !== undefined;
  }

  private validateClaims(payload: JWTPayload, kid: string, expectedAudience?: string): JWTVerifyResult {
    if (payload.iss !== 'payswap') {
      return { valid: false, error: 'issuer', verifiedByKid: kid };
    }
    if (expectedAudience && payload.aud !== expectedAudience) {
      return { valid: false, error: 'audience', verifiedByKid: kid };
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return { valid: false, error: 'expired', verifiedByKid: kid };
    }
    return { valid: true, payload, verifiedByKid: kid };
  }

  private maybeDropPrevious(): void {
    if (this.previous && Date.now() > this.previous.expiresAt) {
      logger.info('JWT previous secret overlap window expired — dropping', {
        kid: this.previous.kid,
      });
      this.previous = undefined;
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

const DEV_FALLBACK_SECRET = 'payswap-dev-jwt-secret-DO-NOT-USE-IN-PRODUCTION';

/** Singleton JWT service. Uses PAYSWAP_JWT_SECRET env var or a dev fallback. */
export const jwtService = new JWTService(process.env.PAYSWAP_JWT_SECRET ?? (() => {
  logger.warn('PAYSWAP_JWT_SECRET not set — using dev fallback (NOT for production)', {
    env: process.env.NODE_ENV ?? 'development',
  });
  return DEV_FALLBACK_SECRET;
})());
