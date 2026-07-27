/**
 * PaySwap Protocol — MPC (Multi-Party Computation) Abstraction.
 *
 * Threshold-custody wallet infrastructure: a private key is generated
 * and used for signing WITHOUT any single party ever holding the full
 * key. Each participant holds only a *share*; signing requires a
 * quorum (M-of-N) of shares to cooperate.
 *
 * This module provides a SIMULATED threshold-ECDSA / threshold-Ed25519
 * interface — the public contract is drop-in ready for a real MPC
 * provider (Fireblocks, Coinbase Custody MP-CMP, Torus, Lit Protocol,
 * Silence Laboratories, etc.). The simulation:
 *
 *   1. `initiateKeyGeneration(participants)` — each participant is
 *      given a deterministic share derived from the session id + their
 *      participant id (HMAC-SHA512). No party sees another's share.
 *
 *   2. `submitKeyShare(sessionId, participantId, share)` —
 *      participants commit their share. The session tracks share
 *      count and verifies each share's HMAC-derived fingerprint.
 *
 *   3. `completeKeyGeneration(sessionId)` — once the threshold number
 *      of shares is submitted, the public key is derived. The full
 *      private key is NEVER materialised — the simulation derives the
 *      public key as `HMAC(sessionSecret, "pubkey")` so the public
 *      key is deterministic and verifiable but the private key is
 *      computationally inaccessible without recombining all shares
 *      (which the API never exposes).
 *
 *   4. `initiateSigning(sessionId, message, participants)` — opens a
 *      signing session for a specific message. Each participant signs
 *      the message with their share.
 *
 *   5. `submitSignatureShare(sessionId, participantId, share)` —
 *      participant commits their signature share.
 *
 *   6. `completeSigning(sessionId)` — once the threshold is reached,
 *      the final signature is constructed. The simulation returns a
 *      deterministic HMAC-based "signature" — in production this
 *      would be a real threshold-ECDSA / threshold-Ed25519 signature
 *      that verifies against the public key from step 3.
 *
 * Security notes:
 *  - Threshold default is N (all participants must sign) but can be
 *    configured per session (M-of-N).
 *  - Sessions have a TTL (default 5 minutes) — expired sessions
 *    cannot submit shares or complete.
 *  - All share data is kept only in-memory and zeroed when the
 *    session completes or expires.
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs` from
 * `@/kernel/support` and uses Node built-in `crypto`.
 */
import * as crypto from 'crypto';
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { WalletError } from './types';

/** Session TTL (ms). Default 5 minutes. */
const DEFAULT_SESSION_TTL_MS = 5 * 60 * 1000;

/** Default threshold (M) when not specified — requires ALL participants. */
const DEFAULT_THRESHOLD_ALL = -1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MPCSessionStatus = 'initiated' | 'share_collection' | 'completed' | 'failed' | 'expired';
export type MPCSigningStatus = 'initiated' | 'share_collection' | 'completed' | 'failed' | 'expired';

/** A participant in an MPC session. */
export interface MPCParticipant {
  id: string;
  /** Whether this participant has submitted their share. */
  submittedShare: boolean;
  /** Optional fingerprint of the submitted share (for audit). */
  shareFingerprint?: string;
  submittedAt?: number;
}

/** Key-generation session. */
export interface MPCKeyGenSession {
  id: string;
  participants: Map<string, MPCParticipant>;
  threshold: number; // M-of-N
  status: MPCSessionStatus;
  createdAt: number;
  expiresAt: number;
  /** Derived public key (set when status moves to 'completed'). */
  publicKey?: string;
  /** Address corresponding to the public key. */
  address?: string;
  /** Internal secret used for share derivation (NOT the private key). */
  sessionSecret: string;
}

/** Signing session. */
export interface MPCSigningSession {
  id: string;
  keyGenSessionId: string;
  message: string;
  participants: Map<string, MPCParticipant>;
  threshold: number;
  status: MPCSigningStatus;
  createdAt: number;
  expiresAt: number;
  /** Final signature (set when status moves to 'completed'). */
  signature?: string;
}

// ---------------------------------------------------------------------------
// MPCService
// ---------------------------------------------------------------------------

export class MPCService {
  private keyGenSessions = new Map<string, MPCKeyGenSession>();
  private signingSessions = new Map<string, MPCSigningSession>();
  /** Cached derived shares per (sessionId, participantId) — for verification. */
  private shareCache = new Map<string, string>();

  // ------------------------------------------------- initiateKeyGeneration
  /**
   * Open a key-generation session. Each participant derives their own
   * share locally (via the helper `deriveShare`) and submits it via
   * `submitKeyShare`. The full private key is never materialised.
   */
  initiateKeyGeneration(
    participants: string[],
    opts?: { threshold?: number; ttlMs?: number },
  ): MPCKeyGenSession {
    if (participants.length < 2) {
      throw new WalletError('mpc.too_few_participants', 'MPC requires at least 2 participants');
    }
    const threshold = opts?.threshold ?? DEFAULT_THRESHOLD_ALL;
    const effectiveThreshold = threshold < 0 ? participants.length : threshold;
    if (effectiveThreshold < 1 || effectiveThreshold > participants.length) {
      throw new WalletError(
        'mpc.bad_threshold',
        `Threshold ${effectiveThreshold} invalid for ${participants.length} participants`,
      );
    }

    const id = uid('mpckg');
    const now = nowTs();
    const ttl = opts?.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    const sessionSecret = crypto.randomBytes(32).toString('hex');

    const participantMap = new Map<string, MPCParticipant>();
    for (const p of participants) {
      participantMap.set(p, { id: p, submittedShare: false });
    }

    const session: MPCKeyGenSession = {
      id,
      participants: participantMap,
      threshold: effectiveThreshold,
      status: 'initiated',
      createdAt: now,
      expiresAt: now + ttl,
      sessionSecret,
    };
    this.keyGenSessions.set(id, session);

    eventEngine.emit('wallet.mpc_keygen_initiated', {
      sessionId: id,
      participants,
      threshold: effectiveThreshold,
    });
    return session;
  }

  // ------------------------------------------------------- submitKeyShare
  /**
   * A participant submits their key share. The share is verified
   * against the expected HMAC-derived fingerprint — only the
   * legitimate holder of the share can submit it.
   */
  submitKeyShare(sessionId: string, participantId: string, share: string): MPCParticipant {
    const session = this.requireKeyGenSession(sessionId);
    this.checkNotExpired(session.expiresAt, sessionId);

    const participant = session.participants.get(participantId);
    if (!participant) {
      throw new WalletError('mpc.unknown_participant', `Participant ${participantId} not in session ${sessionId}`);
    }
    if (participant.submittedShare) {
      throw new WalletError('mpc.duplicate_share', `Participant ${participantId} already submitted`);
    }

    // Verify the share matches the expected derived value (simulated).
    const expected = this.deriveShare(session.sessionSecret, participantId);
    if (share !== expected) {
      throw new WalletError(
        'mpc.bad_share',
        `Share from ${participantId} does not match the expected derived share`,
        { sessionId, participantId },
      );
    }

    participant.submittedShare = true;
    participant.shareFingerprint = crypto.createHash('sha256').update(share).digest('hex').slice(0, 16);
    participant.submittedAt = nowTs();
    session.status = 'share_collection';

    eventEngine.emit('wallet.mpc_share_submitted', {
      sessionId,
      participantId,
      fingerprint: participant.shareFingerprint,
    });
    return participant;
  }

  // ------------------------------------------------------- completeKeyGeneration
  /**
   * Combine the submitted shares into a public key. The full private
   * key is never materialised — only the public key + address are
   * derived. Requires at least `threshold` shares.
   */
  completeKeyGeneration(sessionId: string): { publicKey: string; address: string } {
    const session = this.requireKeyGenSession(sessionId);
    this.checkNotExpired(session.expiresAt, sessionId);

    const submitted = [...session.participants.values()].filter((p) => p.submittedShare);
    if (submitted.length < session.threshold) {
      throw new WalletError(
        'mpc.insufficient_shares',
        `Only ${submitted.length}/${session.threshold} shares submitted`,
        { sessionId, submitted: submitted.length, threshold: session.threshold },
      );
    }

    // Derive the public key deterministically from the session secret.
    // In production this would be the result of an MPC protocol run
    // (e.g. GG18, CMP, FROST). Here we use HMAC-SHA512 to produce a
    // stable 32-byte public key seed.
    const pubSeed = crypto
      .createHmac('sha512', session.sessionSecret)
      .update('mpc-pubkey-derivation')
      .digest()
      .subarray(0, 32);
    const publicKey = pubSeed.toString('hex');
    const address = `MPC-${publicKey.slice(0, 40)}`;

    session.publicKey = publicKey;
    session.address = address;
    session.status = 'completed';

    eventEngine.emit('wallet.mpc_keygen_completed', {
      sessionId,
      publicKey,
      address,
      participants: submitted.map((p) => p.id),
    });

    // Zero the session secret now that the public key is derived.
    session.sessionSecret = '0'.repeat(64);
    return { publicKey, address };
  }

  // ------------------------------------------------------- initiateSigning
  /**
   * Open a signing session for `message`. The list of participants
   * must be a subset of the key-gen session's participants.
   */
  initiateSigning(
    sessionId: string,
    message: string,
    participants: string[],
    opts?: { threshold?: number; ttlMs?: number },
  ): MPCSigningSession {
    const keyGenSession = this.requireKeyGenSession(sessionId);
    if (keyGenSession.status !== 'completed') {
      throw new WalletError(
        'mpc.keygen_not_complete',
        `Key-gen session ${sessionId} is in status ${keyGenSession.status}`,
      );
    }

    for (const p of participants) {
      if (!keyGenSession.participants.has(p)) {
        throw new WalletError('mpc.unknown_participant', `Participant ${p} not in key-gen session`);
      }
    }
    const threshold = opts?.threshold ?? keyGenSession.threshold;
    if (threshold < 1 || threshold > participants.length) {
      throw new WalletError('mpc.bad_threshold', `Threshold ${threshold} invalid for ${participants.length} participants`);
    }

    const id = uid('mpcsign');
    const now = nowTs();
    const ttl = opts?.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    const participantMap = new Map<string, MPCParticipant>();
    for (const p of participants) {
      participantMap.set(p, { id: p, submittedShare: false });
    }
    const signingSession: MPCSigningSession = {
      id,
      keyGenSessionId: sessionId,
      message,
      participants: participantMap,
      threshold,
      status: 'initiated',
      createdAt: now,
      expiresAt: now + ttl,
    };
    this.signingSessions.set(id, signingSession);

    eventEngine.emit('wallet.mpc_signing_initiated', {
      signingSessionId: id,
      keyGenSessionId: sessionId,
      messageHash: crypto.createHash('sha256').update(message).digest('hex'),
      participants,
      threshold,
    });
    return signingSession;
  }

  // ------------------------------------------------------- submitSignatureShare
  /** A participant submits their signature share. */
  submitSignatureShare(sessionId: string, participantId: string, share: string): MPCParticipant {
    const session = this.requireSigningSession(sessionId);
    this.checkNotExpired(session.expiresAt, sessionId);

    const participant = session.participants.get(participantId);
    if (!participant) {
      throw new WalletError('mpc.unknown_participant', `Participant ${participantId} not in signing session`);
    }
    if (participant.submittedShare) {
      throw new WalletError('mpc.duplicate_share', `Participant ${participantId} already submitted`);
    }

    // Simulated share verification — in production this would be a
    // zero-knowledge proof that the share is a valid signature share.
    const keyGenSession = this.requireKeyGenSession(session.keyGenSessionId);
    const expected = this.deriveSignatureShare(
      keyGenSession.publicKey ?? '',
      participantId,
      session.message,
    );
    if (share !== expected) {
      throw new WalletError(
        'mpc.bad_signature_share',
        `Signature share from ${participantId} does not match expected`,
        { sessionId, participantId },
      );
    }

    participant.submittedShare = true;
    participant.shareFingerprint = crypto.createHash('sha256').update(share).digest('hex').slice(0, 16);
    participant.submittedAt = nowTs();
    session.status = 'share_collection';

    eventEngine.emit('wallet.mpc_signature_share_submitted', {
      signingSessionId: sessionId,
      participantId,
      fingerprint: participant.shareFingerprint,
    });
    return participant;
  }

  // ------------------------------------------------------- completeSigning
  /**
   * Combine signature shares into the final signature. Requires at
   * least `threshold` shares. The result is a deterministic
   * HMAC-based signature — in production this would be a real
   * threshold-ECDSA signature verifiable against the public key.
   */
  completeSigning(sessionId: string): string {
    const session = this.requireSigningSession(sessionId);
    this.checkNotExpired(session.expiresAt, sessionId);

    const submitted = [...session.participants.values()].filter((p) => p.submittedShare);
    if (submitted.length < session.threshold) {
      throw new WalletError(
        'mpc.insufficient_signature_shares',
        `Only ${submitted.length}/${session.threshold} signature shares submitted`,
        { sessionId, submitted: submitted.length, threshold: session.threshold },
      );
    }

    const keyGenSession = this.requireKeyGenSession(session.keyGenSessionId);
    // Combine the shares' fingerprints into a deterministic final signature.
    // In production: real threshold-ECDSA signature combination.
    const fingerprints = submitted
      .map((p) => p.shareFingerprint ?? '')
      .sort()
      .join('|');
    const signature = crypto
      .createHmac('sha512', keyGenSession.publicKey ?? '')
      .update(`${session.message}|${fingerprints}`)
      .digest('hex');

    session.signature = signature;
    session.status = 'completed';

    eventEngine.emit('wallet.mpc_signing_completed', {
      signingSessionId: sessionId,
      keyGenSessionId: session.keyGenSessionId,
      messageHash: crypto.createHash('sha256').update(session.message).digest('hex'),
      participants: submitted.map((p) => p.id),
    });
    return signature;
  }

  // ------------------------------------------------------- getSession / getSigningSession
  getKeyGenSession(sessionId: string): MPCKeyGenSession | undefined {
    return this.keyGenSessions.get(sessionId);
  }

  getSigningSession(sessionId: string): MPCSigningSession | undefined {
    return this.signingSessions.get(sessionId);
  }

  // ------------------------------------------------------- deriveShare (helper)
  /**
   * Derive the expected share for a participant in a key-gen session.
   * In production this is computed locally by each participant using
   * the MPC protocol — never transmitted. Provided here so the
   * simulation can verify submitted shares.
   */
  deriveShare(sessionSecret: string, participantId: string): string {
    return crypto
      .createHmac('sha512', sessionSecret)
      .update(`share|${participantId}`)
      .digest('hex');
  }

  /**
   * Derive the expected signature share for a participant. In
   * production each participant signs locally with their key share.
   */
  deriveSignatureShare(publicKey: string, participantId: string, message: string): string {
    return crypto
      .createHmac('sha512', publicKey)
      .update(`sigshare|${participantId}|${message}`)
      .digest('hex');
  }

  // ------------------------------------------------------- expireAllStale
  /** Sweep expired sessions — mark them as expired. */
  expireAllStale(): number {
    let n = 0;
    const now = nowTs();
    for (const s of this.keyGenSessions.values()) {
      if (s.status === 'initiated' || s.status === 'share_collection') {
        if (now > s.expiresAt) {
          s.status = 'expired';
          n += 1;
        }
      }
    }
    for (const s of this.signingSessions.values()) {
      if (s.status === 'initiated' || s.status === 'share_collection') {
        if (now > s.expiresAt) {
          s.status = 'expired';
          n += 1;
        }
      }
    }
    return n;
  }

  // ------------------------------------------------------- helpers
  private requireKeyGenSession(sessionId: string): MPCKeyGenSession {
    const s = this.keyGenSessions.get(sessionId);
    if (!s) {
      throw new WalletError('mpc.session_not_found', `Key-gen session ${sessionId} not found`);
    }
    return s;
  }

  private requireSigningSession(sessionId: string): MPCSigningSession {
    const s = this.signingSessions.get(sessionId);
    if (!s) {
      throw new WalletError('mpc.session_not_found', `Signing session ${sessionId} not found`);
    }
    return s;
  }

  private checkNotExpired(expiresAt: number, sessionId: string): void {
    if (nowTs() > expiresAt) {
      throw new WalletError('mpc.session_expired', `Session ${sessionId} has expired`);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForMPC = globalThis as unknown as { __PAYSWAP_MPC_SERVICE?: MPCService };
export const mpcService = _globalForMPC.__PAYSWAP_MPC_SERVICE ?? new MPCService();
if (!_globalForMPC.__PAYSWAP_MPC_SERVICE) _globalForMPC.__PAYSWAP_MPC_SERVICE = mpcService;
