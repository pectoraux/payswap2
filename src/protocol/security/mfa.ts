/**
 * PaySwap Protocol — Security — Multi-Factor Authentication (TOTP).
 *
 * RFC 6238 TOTP implementation using ONLY Node built-in `crypto`.
 *   - Secret: 20 random bytes, base32-encoded (RFC 4648).
 *   - HMAC: SHA-1 over 8-byte big-endian time counter.
 *   - Step: 30 seconds. Digits: 6. Window: ±1 (allows clock drift).
 *   - Backup codes: 8 one-time codes, SHA-256 hashed at enrollment.
 *
 * The otpauth URI (for QR codes) follows the de-facto Google Authenticator
 * format:
 *   otpauth://totp/PaySwap:<email>?secret=<base32>&issuer=PaySwap&algorithm=SHA1&digits=6&period=30
 *
 * Frozen-kernel compliance: imports only `uid` from kernel support (read-only).
 */
import { createHmac, randomBytes, createHash } from 'node:crypto';
import { logger } from '@/protocol/ops/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MFAMethod = 'totp' | 'sms' | 'email';

export interface MFAEnrollment {
  userId: string;
  method: MFAMethod;
  /** Base32-encoded secret (only present for TOTP). */
  secret?: string;
  /** SHA-256 hashes of one-time backup codes (never store plaintext). */
  backupCodeHashes: string[];
  /** Backup codes that have been consumed (so we can audit). */
  consumedBackupCodes: string[];
  enabledAt: number;
  lastUsedAt?: number;
}

export interface MFAEnrollResult {
  enrollment: MFAEnrollment;
  /** The plaintext backup codes — returned ONCE at enrollment. */
  backupCodes: string[];
  /** otpauth:// URI for QR code generation. */
  otpauthUri: string;
  /** Base32 secret (for manual entry). */
  secret: string;
}

// ─── Base32 (RFC 4648) ───────────────────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode bytes to base32 (RFC 4648, no padding). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

/** Decode a base32 string to bytes (RFC 4648, tolerates padding + lowercase). */
export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/g, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // skip invalid chars
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ─── TOTP core (RFC 6238) ────────────────────────────────────────────────────

const TOTP_STEP = 30; // seconds
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // ±1 step

/** Generate a TOTP code for a given secret + counter. */
export function totpCode(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  // 8-byte big-endian counter.
  const counterBuf = Buffer.alloc(8);
  // JS bitwise ops are 32-bit; use writeUInt32BE on the high + low halves.
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', secret).update(counterBuf).digest();
  // Dynamic truncation (RFC 4226).
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = binary % Math.pow(10, digits);
  return code.toString().padStart(digits, '0');
}

/** Compute the time counter for `timeMs` (defaults to Date.now()). */
export function totpCounter(timeMs: number = Date.now()): number {
  return Math.floor(timeMs / 1000 / TOTP_STEP);
}

/**
 * Verify a TOTP code against a secret with a ±1 step window (allows clock
 * drift). Returns true if any of (counter-1, counter, counter+1) produces
 * the given code.
 *
 * Uses constant-time string comparison to avoid timing attacks.
 */
export function verifyTotp(code: string, secret: Buffer, timeMs: number = Date.now()): boolean {
  if (!/^\d+$/.test(code) || code.length !== TOTP_DIGITS) return false;
  const counter = totpCounter(timeMs);
  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift++) {
    const expected = totpCode(secret, counter + drift);
    if (constantTimeEqualString(code, expected)) return true;
  }
  return false;
}

/** Constant-time string comparison (assumes equal length). */
function constantTimeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Backup codes ────────────────────────────────────────────────────────────

const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_LEN = 10; // digits

/** Generate 8 random one-time backup codes. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = randomBytes(4).readUInt32BE(0);
    codes.push(n.toString().padStart(BACKUP_CODE_LEN, '0').slice(-BACKUP_CODE_LEN));
  }
  return codes;
}

/** Hash a backup code with SHA-256 (for storage). */
export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// ─── MFAService ──────────────────────────────────────────────────────────────

export class MFAService {
  private enrollments: Map<string, MFAEnrollment> = new Map();

  /** Enroll a user in MFA. Returns the secret + plaintext backup codes
   *  (which must be displayed to the user ONCE — they are NOT recoverable). */
  enroll(userId: string, method: MFAMethod = 'totp', label?: string): MFAEnrollResult {
    if (method !== 'totp') {
      // SMS / email would require an external provider — not implemented here.
      throw new Error(`MFAService.enroll: method "${method}" not implemented (use 'totp')`);
    }
    const secretBytes = randomBytes(20);
    const secret = base32Encode(secretBytes);
    const backupCodes = generateBackupCodes();
    const backupCodeHashes = backupCodes.map(hashBackupCode);
    const enrollment: MFAEnrollment = {
      userId,
      method,
      secret,
      backupCodeHashes,
      consumedBackupCodes: [],
      enabledAt: Date.now(),
    };
    this.enrollments.set(userId, enrollment);
    const displayLabel = label ?? userId;
    const otpauthUri = `otpauth://totp/PaySwap:${encodeURIComponent(displayLabel)}?secret=${secret}&issuer=PaySwap&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP}`;
    logger.info('MFA enrolled', { userId, method });
    return { enrollment, backupCodes, otpauthUri, secret };
  }

  /** Verify a TOTP code OR a backup code for the user. Returns true on success.
   *  If a backup code is used, it is consumed (one-time). */
  verify(userId: string, code: string): boolean {
    const enr = this.enrollments.get(userId);
    if (!enr || !enr.secret) return false;
    // Try TOTP first.
    const secretBytes = base32Decode(enr.secret);
    if (verifyTotp(code, secretBytes)) {
      enr.lastUsedAt = Date.now();
      return true;
    }
    // Try backup codes.
    const codeHash = hashBackupCode(code);
    if (enr.backupCodeHashes.includes(codeHash) && !enr.consumedBackupCodes.includes(codeHash)) {
      enr.consumedBackupCodes.push(codeHash);
      enr.lastUsedAt = Date.now();
      logger.info('MFA backup code consumed', { userId });
      return true;
    }
    return false;
  }

  /** Disable MFA for a user (removes the enrollment). */
  disable(userId: string): boolean {
    const existed = this.enrollments.delete(userId);
    if (existed) logger.info('MFA disabled', { userId });
    return existed;
  }

  /** Returns true if the user has an active MFA enrollment. */
  isEnrolled(userId: string): boolean {
    return this.enrollments.has(userId);
  }

  /** Returns the enrollment record (or undefined). */
  getEnrollment(userId: string): MFAEnrollment | undefined {
    return this.enrollments.get(userId);
  }

  /** Returns the number of backup codes remaining. */
  remainingBackupCodes(userId: string): number {
    const enr = this.enrollments.get(userId);
    if (!enr) return 0;
    return enr.backupCodeHashes.length - enr.consumedBackupCodes.length;
  }

  /** Reset (for tests). */
  reset(): void {
    this.enrollments.clear();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const mfaService = new MFAService();
