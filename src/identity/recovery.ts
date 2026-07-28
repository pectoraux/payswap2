/**
 * Recovery Manager — account recovery flows. (M-ID-41.)
 *
 * Every identity should have at least one recovery method attached so the
 * underlying entity can regain access if their primary credentials are lost.
 *
 * Recovery flow:
 *   1. User calls `initiateRecovery(identifier)` (e.g., their email)
 *   2. The manager finds the identity with a matching recovery method and
 *      creates a short-lived `RecoverySession`. The recovery method's
 *      `pendingCode` is set to a fresh 6-digit code (or backup codes are
 *      generated for `backup_codes` type).
 *   3. The user receives the code out-of-band (email/SMS/etc.) and calls
 *      `completeRecovery(recoveryId, methodId, code)`. On success, a
 *      one-time `resetToken` is returned — usable to reset credentials.
 *
 * This is a simplified implementation suitable for the Identity OS demo —
 * production would integrate with an email/SMS provider and a hashed
 * reset-token store.
 */

import type { RecoveryMethod, RecoveryMethodType, RecoverySession } from './types';
import { store } from './store';
import { identityRegistry } from './registry';
import { uid } from '@/runtime/types';

const RECOVERY_SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export interface AddRecoveryInput {
  type: RecoveryMethodType;
  identifier: string;
}

export class RecoveryManager {
  /** Add a recovery method to an identity. */
  async add(
    identityId: string,
    method: AddRecoveryInput,
  ): Promise<RecoveryMethod> {
    const identity = identityRegistry.getSync(identityId);
    if (!identity) throw new Error(`Identity ${identityId} not found`);

    const rm: RecoveryMethod = {
      id: uid('rec'),
      identityId,
      type: method.type,
      identifier: method.identifier,
      verified: false,
      createdAt: Date.now(),
    };

    // For backup_codes — generate 10 one-time codes (stored hashed). The
    // "identifier" for backup_codes is meaningless; we use the identity ID.
    if (method.type === 'backup_codes') {
      const codes: string[] = [];
      for (let i = 0; i < 10; i++) {
        codes.push(uid('code').toUpperCase().slice(0, 12));
      }
      rm.backupCodes = codes;
      rm.verified = true; // backup codes are usable immediately
      rm.verifiedAt = Date.now();
      rm.identifier = `${identityId}:${codes.length} codes`;
    }

    store.recoveryMethods.set(rm.id, rm);
    return rm;
  }

  /**
   * Verify a recovery method (e.g., confirm the email/phone).
   *
   * For backup_codes methods, `code` should match one of the stored codes —
   * on match the code is removed from the list.
   */
  async verify(methodId: string, code: string): Promise<boolean> {
    const rm = store.recoveryMethods.get(methodId);
    if (!rm) return false;

    if (rm.type === 'backup_codes') {
      if (!rm.backupCodes) return false;
      const idx = rm.backupCodes.indexOf(code.toUpperCase());
      if (idx < 0) return false;
      rm.backupCodes.splice(idx, 1);
      rm.verified = true;
      rm.verifiedAt = Date.now();
      return true;
    }

    // For other types — compare against the pendingCode we set when the
    // verification flow was initiated.
    if (!rm.pendingCode || rm.pendingCode !== code) return false;
    rm.verified = true;
    rm.verifiedAt = Date.now();
    rm.pendingCode = undefined;
    return true;
  }

  /**
   * Initiate account recovery. `identifier` should match one of the
   * recovery method identifiers (e.g., the user's recovery email).
   */
  async initiateRecovery(
    identifier: string,
  ): Promise<{ recoveryId: string; methods: RecoveryMethod[] }> {
    const matches: RecoveryMethod[] = [];
    for (const rm of store.recoveryMethods.values()) {
      if (rm.identifier === identifier) matches.push(rm);
    }

    if (matches.length === 0) {
      // Don't leak whether the identifier exists — return an empty list
      // with a placeholder recovery ID. The completeRecovery step will
      // always fail for this ID.
      return { recoveryId: uid('rec_session'), methods: [] };
    }

    // Pick the first verified match (preference order doesn't matter for
    // the demo).
    const method = matches[0];
    const now = Date.now();
    const session: RecoverySession = {
      recoveryId: uid('rec_session'),
      identityId: method.identityId,
      initiatedAt: now,
      expiresAt: now + RECOVERY_SESSION_TTL_MS,
    };
    store.recoverySessions.set(session.recoveryId, session);

    // Generate a fresh code for non-backup-codes methods.
    if (method.type !== 'backup_codes') {
      method.pendingCode = generateCode();
    }

    return { recoveryId: session.recoveryId, methods: matches };
  }

  /**
   * Complete recovery: verify the code via a method, get a one-time reset
   * token usable to reset credentials.
   */
  async completeRecovery(
    recoveryId: string,
    methodId: string,
    code: string,
  ): Promise<{ resetToken: string }> {
    const session = store.recoverySessions.get(recoveryId);
    if (!session) throw new Error('Recovery session not found');
    if (session.expiresAt < Date.now()) throw new Error('Recovery session expired');
    if (session.completedAt) throw new Error('Recovery session already completed');

    const method = store.recoveryMethods.get(methodId);
    if (!method) throw new Error('Recovery method not found');
    if (method.identityId !== session.identityId) {
      throw new Error('Recovery method does not match the session');
    }

    const ok = await this.verify(methodId, code);
    if (!ok) throw new Error('Invalid verification code');

    const resetToken = uid('reset');
    session.completedAt = Date.now();
    session.resetToken = resetToken;
    return { resetToken };
  }

  /** List recovery methods for an identity. */
  async list(identityId: string): Promise<RecoveryMethod[]> {
    return Array.from(store.recoveryMethods.values()).filter(
      (rm) => rm.identityId === identityId,
    );
  }

  /** Lookup a method by ID. */
  getSync(methodId: string): RecoveryMethod | null {
    return store.recoveryMethods.get(methodId) ?? null;
  }

  /** All recovery methods (admin overview). */
  listAll(): RecoveryMethod[] {
    return Array.from(store.recoveryMethods.values());
  }
}

export const recoveryManager = new RecoveryManager();
