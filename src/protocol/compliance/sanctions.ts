/**
 * PaySwap Protocol — Sanctions Screening Service.
 *
 * Responsibilities:
 *  - `screenEntity(entityId, name, dateOfBirth?)` runs fuzzy name matching
 *    against OFAC SDN, EU Consolidated, UN Consolidated, UK HMT OFSI,
 *    and PaySwap custom internal watchlist.
 *  - `screenTransaction(tx)` screens both the originator and beneficiary
 *    names of a transaction.
 *  - Hits are recorded with a similarity score; analysts confirm or
 *    reject them as false positives via `reviewHit(hitId, isFalsePositive)`.
 *  - `isClear(entityId)` is the hard gate: returns true only when the
 *    entity has no active (non-false-positive) sanctions hits. The
 *    payment flow calls this before settlement.
 *
 * Fuzzy matching uses Levenshtein distance (normalised) plus a Jaccard
 * token-set similarity. A hit is raised when the combined similarity
 * exceeds the configured threshold (default 0.85).
 *
 * Provider integration (Chainalysis KYT, TRM Labs, Refinitiv World-Check
 * One, Dow Jones Risk & Compliance) replaces `matchName()` with a call
 * to the external API; the public `SanctionsHit` contract is unchanged.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import {
  ComplianceError,
  SAMPLE_SANCTIONS_ENTRIES,
  type ComplianceTx,
  type SanctionsHit,
  type SanctionsList,
} from './types';

/** Similarity threshold above which a hit is raised (0–1). */
const DEFAULT_MATCH_THRESHOLD = 0.85;

/** Input for screening an entity or transaction party. */
export interface ScreenInput {
  entityId: string;
  name: string;
  dateOfBirth?: string;
  country?: string;
}

/** Result of a screening pass. */
export interface ScreenResult {
  entityId: string;
  hits: SanctionsHit[];
  isClear: boolean;
}

export class SanctionsService {
  private hits = new Map<string, SanctionsHit>();
  private matchThreshold = DEFAULT_MATCH_THRESHOLD;
  /** Loaded sanctions list — defaults to the simulated sample list. */
  private list: typeof SAMPLE_SANCTIONS_ENTRIES = [...SAMPLE_SANCTIONS_ENTRIES];

  // ------------------------------------------------------- configureThreshold
  configureMatchThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error('match threshold must be in [0, 1]');
    }
    this.matchThreshold = threshold;
  }

  /** Replace the in-memory sanctions list (e.g. when loading a real feed). */
  loadList(entries: typeof SAMPLE_SANCTIONS_ENTRIES): void {
    this.list = [...entries];
  }

  // ------------------------------------------------------- screenEntity
  screenEntity(entityId: string, name: string, dateOfBirth?: string): ScreenResult {
    const hits = this.matchName(name, dateOfBirth)
      .filter((m) => m.score >= this.matchThreshold)
      .map((m) => this.recordHit(entityId, m));

    for (const hit of hits) {
      eventEngine.emit('compliance.sanctions_hit', {
        hitId: hit.id,
        entityId: hit.entityId,
        list: hit.list,
        matchedName: hit.matchedName,
        score: hit.score,
      });
    }

    return { entityId, hits, isClear: hits.length === 0 };
  }

  // ------------------------------------------------------- screenTransaction
  screenTransaction(tx: ComplianceTx, parties: { originator: ScreenInput; beneficiary: ScreenInput }): ScreenResult[] {
    const results: ScreenResult[] = [];
    const originatorResult = this.screenEntity(
      parties.originator.entityId,
      parties.originator.name,
      parties.originator.dateOfBirth,
    );
    if (!originatorResult.isClear) results.push(originatorResult);

    const beneficiaryResult = this.screenEntity(
      parties.beneficiary.entityId,
      parties.beneficiary.name,
      parties.beneficiary.dateOfBirth,
    );
    if (!beneficiaryResult.isClear) results.push(beneficiaryResult);

    return results;
  }

  // ------------------------------------------------------- getHits
  getHits(entityId?: string): SanctionsHit[] {
    const all = [...this.hits.values()];
    return entityId ? all.filter((h) => h.entityId === entityId) : all;
  }

  // ------------------------------------------------------- reviewHit
  reviewHit(hitId: string, isFalsePositive: boolean): SanctionsHit {
    const hit = this.hits.get(hitId);
    if (!hit) {
      throw new ComplianceError('sanctions.hit_not_found', `Sanctions hit ${hitId} not found`);
    }
    hit.isFalsePositive = isFalsePositive;
    hit.reviewedAt = nowTs();
    return hit;
  }

  // ------------------------------------------------------- isClear
  /** Hard gate: true only when entity has no active (non-false-positive) hits. */
  isClear(entityId: string): boolean {
    const active = this.getHits(entityId).filter((h) => !h.isFalsePositive);
    return active.length === 0;
  }

  /** Throw if entity has any active sanctions hit. */
  requireClear(entityId: string): void {
    if (!this.isClear(entityId)) {
      const active = this.getHits(entityId).filter((h) => !h.isFalsePositive);
      throw new ComplianceError(
        'sanctions.blocked',
        `Entity ${entityId} has ${active.length} active sanctions hit(s)`,
        { entityId, hits: active.map((h) => ({ list: h.list, name: h.matchedName, score: h.score })) },
      );
    }
  }

  // ------------------------------------------------------- matcher
  /**
   * Combined Levenshtein + token-Jaccard similarity. Returns all entries
   * with their score (above or below threshold — caller filters).
   */
  private matchName(name: string, _dateOfBirth?: string) {
    const query = name.toUpperCase().trim();
    return this.list
      .map((entry) => {
        const candidate = entry.name.toUpperCase().trim();
        const lev = 1 - levenshtein(query, candidate) / Math.max(query.length, candidate.length, 1);
        const jac = tokenJaccard(query, candidate);
        const score = Math.max(lev, jac);
        return { entry, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  private recordHit(
    entityId: string,
    match: { entry: (typeof SAMPLE_SANCTIONS_ENTRIES)[number]; score: number },
  ): SanctionsHit {
    const id = uid('sanc');
    const hit: SanctionsHit = {
      id,
      entityId,
      list: match.entry.list as SanctionsList,
      matchedName: match.entry.name,
      matchedEntry: match.entry.entry,
      score: Number(match.score.toFixed(4)),
      createdAt: nowTs(),
    };
    this.hits.set(id, hit);
    return hit;
  }
}

// ---------------------------------------------------------------------------
// Fuzzy-matching helpers
// ---------------------------------------------------------------------------

/** Iterative Levenshtein distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Token-set Jaccard similarity for word-level matching. */
export function tokenJaccard(a: string, b: string): number {
  const sa = new Set(a.split(/\s+/).filter(Boolean));
  const sb = new Set(b.split(/\s+/).filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForSanctions = globalThis as unknown as { __PAYSWAP_SANCTIONS_SERVICE?: SanctionsService };
export const sanctionsService =
  _globalForSanctions.__PAYSWAP_SANCTIONS_SERVICE ?? new SanctionsService();
if (!_globalForSanctions.__PAYSWAP_SANCTIONS_SERVICE) {
  _globalForSanctions.__PAYSWAP_SANCTIONS_SERVICE = sanctionsService;
}
