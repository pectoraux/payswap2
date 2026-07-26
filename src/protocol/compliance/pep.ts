/**
 * PaySwap Protocol — PEP (Politically Exposed Person) Screening Service.
 *
 * Responsibilities:
 *  - `screenPEP(entityId, name)` runs fuzzy name matching against an
 *    in-memory PEP database (heads of state, senior officials, judicial,
 *    military, state-owned-enterprise executives).
 *  - `getPEPStatus(entityId)` returns the most recent PEP designation.
 *  - `isPEP(entityId)` is the convenience boolean gate.
 *
 * PEPs are not blocked outright, but require enhanced due diligence
 * (KYC level 3) — the risk-scoring engine and KYC service both call
 * into `pepService.isPEP()` to drive that escalation.
 *
 * Provider integration (Refinitiv World-Check, Dow Jones Risk & Compliance,
 * LexisNexis Bridger, Sayari) replaces `matchName()` with a real API
 * call; the public `PEPStatus` contract stays the same.
 */
import { nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { levenshtein, tokenJaccard } from './sanctions';
import {
  SAMPLE_PEP_ENTRIES,
  type PEPStatus,
  type PEPType,
} from './types';

/** Similarity threshold above which an entity is flagged as a PEP. */
const DEFAULT_PEP_MATCH_THRESHOLD = 0.85;

/** Result of a screening pass. */
export interface ScreenPEPResult {
  entityId: string;
  status: PEPStatus;
  matchedName?: string;
  score?: number;
}

export class PEPService {
  private statuses = new Map<string, PEPStatus>();
  private matchThreshold = DEFAULT_PEP_MATCH_THRESHOLD;
  private list: typeof SAMPLE_PEP_ENTRIES = [...SAMPLE_PEP_ENTRIES];

  // ------------------------------------------------------- configureThreshold
  configureMatchThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error('PEP match threshold must be in [0, 1]');
    }
    this.matchThreshold = threshold;
  }

  /** Replace the in-memory PEP list (e.g. when loading a managed feed). */
  loadList(entries: typeof SAMPLE_PEP_ENTRIES): void {
    this.list = [...entries];
  }

  // ------------------------------------------------------- screenPEP
  screenPEP(entityId: string, name: string): ScreenPEPResult {
    const query = name.toUpperCase().trim();
    let bestMatch: { entry: (typeof SAMPLE_PEP_ENTRIES)[number]; score: number } | null = null;
    for (const entry of this.list) {
      const candidate = entry.name.toUpperCase().trim();
      const lev = 1 - levenshtein(query, candidate) / Math.max(query.length, candidate.length, 1);
      const jac = tokenJaccard(query, candidate);
      const score = Math.max(lev, jac);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { entry, score };
      }
    }

    const isPEP = bestMatch !== null && bestMatch.score >= this.matchThreshold;
    const status: PEPStatus = {
      entityId,
      isPEP,
      pepType: isPEP ? (bestMatch!.entry.pepType as PEPType) : 'none',
      source: 'internal_database',
      reviewedAt: nowTs(),
      matchedName: isPEP ? bestMatch!.entry.name : undefined,
      score: isPEP ? Number(bestMatch!.score.toFixed(4)) : undefined,
    };
    this.statuses.set(entityId, status);

    if (isPEP) {
      eventEngine.emit('compliance.pep_detected', {
        entityId,
        pepType: status.pepType,
        matchedName: status.matchedName,
        score: status.score,
      });
    }
    return {
      entityId,
      status,
      matchedName: status.matchedName,
      score: status.score,
    };
  }

  // ------------------------------------------------------- getPEPStatus
  getPEPStatus(entityId: string): PEPStatus | undefined {
    return this.statuses.get(entityId);
  }

  // ------------------------------------------------------- isPEP
  isPEP(entityId: string): boolean {
    return this.statuses.get(entityId)?.isPEP ?? false;
  }

  /** Manual override — allows a compliance analyst to clear or set PEP status. */
  setStatus(entityId: string, status: PEPStatus): void {
    status.reviewedAt = nowTs();
    this.statuses.set(entityId, status);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForPEP = globalThis as unknown as { __PAYSWAP_PEP_SERVICE?: PEPService };
export const pepService = _globalForPEP.__PAYSWAP_PEP_SERVICE ?? new PEPService();
if (!_globalForPEP.__PAYSWAP_PEP_SERVICE) _globalForPEP.__PAYSWAP_PEP_SERVICE = pepService;
