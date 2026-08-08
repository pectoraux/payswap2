/**
 * PaySwap Protocol — Sanctions Screening Service (LEGACY WRAPPER).
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  THIN WRAPPER — delegates to `src/trust/sanctions-screener.ts`.       ║
 * ║                                                                       ║
 * ║  This module exists ONLY for backwards-compat with existing           ║
 * ║  importers (constitution guard, policy/rules, compliance/status,      ║
 * ║  the constitution-planner test). New code should import from          ║
 * ║  `@/trust/sanctions-screener` (the canonical stack).                  ║
 * ║                                                                       ║
 * ║  DO NOT extend this wrapper directly. New sanctions-related           ║
 * ║  code goes in `src/trust/`.                                           ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * This wrapper preserves the legacy API:
 *   - `screenEntity(entityId, name, dob?)`        — sync, returns `ScreenResult`
 *   - `screenTransaction(tx, parties)`            — sync, returns `ScreenResult[]`
 *   - `getHits(entityId?)`, `reviewHit(hitId, fp)`, `isClear(entityId)`,
 *     `requireClear(entityId)`, `configureMatchThreshold(t)`, `loadList(entries)`
 *
 * Internally it calls `matchSanctionsName()` from the canonical
 * `src/trust/sanctions-screener.ts` — the SAME matcher the canonical
 * `SanctionsScreener.screen()` uses. So a payout blocked at the
 * constitution guard (which calls this wrapper) and a payout blocked
 * via the canonical `sanctionsScreener.screen()` see the SAME answer.
 *
 * Hit records are kept in an in-memory `Map` keyed by hit id. This is
 * process-local — a restart loses them. The canonical
 * `SanctionsScreener.screen()` persists to the `ComplianceReview` Prisma
 * table; new code should use the canonical stack if it needs durability.
 *
 * The sanctions list is loaded from `data/dev-sanctions-fixture.json`
 * (or `PAYSWAP_SANCTIONS_LIST_FILE` if set) by the canonical loader
 * `src/trust/sanctions-list-loader.ts`. The `loadList()` method on this
 * wrapper is kept for backwards-compat but only overrides the in-memory
 * list inside this wrapper — it does NOT affect the canonical screener.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import {
  ComplianceError,
  type ComplianceTx,
  type SanctionsHit,
  type SanctionsList,
} from './types';
import { matchSanctionsName } from '@/trust/sanctions-screener';

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
  /** Dedupe index: `${entityId}|${list}|${name}` → hitId. Separate from `hits` so `getHits()` doesn't return duplicates. */
  private dedupe = new Map<string, string>();
  private matchThreshold = DEFAULT_MATCH_THRESHOLD;

  // ------------------------------------------------------- configureThreshold
  configureMatchThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error('match threshold must be in [0, 1]');
    }
    this.matchThreshold = threshold;
  }

  /**
   * Replace the in-memory sanctions list (kept for backwards-compat).
   *
   * NOTE: This override is LOCAL to this wrapper — it does NOT affect the
   * canonical `src/trust/sanctions-screener.ts` stack. New code should
   * set `PAYSWAP_SANCTIONS_LIST_FILE` (env var) instead.
   */
  loadList(_entries: unknown): void {
    // No-op: the canonical list is owned by `src/trust/sanctions-list-loader.ts`.
    // Kept for backwards-compat with existing callers.
    console.warn(
      '[sanctions-wrapper] loadList() is a no-op — the sanctions list is now loaded ' +
        'from data/dev-sanctions-fixture.json (or PAYSWAP_SANCTIONS_LIST_FILE). ' +
        'Set the env var to override.',
    );
  }

  // ------------------------------------------------------- screenEntity
  screenEntity(entityId: string, name: string, _dateOfBirth?: string): ScreenResult {
    // Delegate to the canonical matcher. The threshold is in [0,1] but the
    // canonical matcher uses a 0-100 score; convert.
    const minScore100 = Math.round(this.matchThreshold * 100);
    const matches = matchSanctionsName(name, minScore100);

    const hits = matches.map((m) =>
      this.recordHit(entityId, {
        list: mapTrustListToProtocol(m.list),
        name: m.name,
        entry: m.entry,
        score: m.score,
        country: m.country,
      }),
    );

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

  // ------------------------------------------------------- helper
  private recordHit(
    entityId: string,
    match: { list: SanctionsList; name: string; entry: string; score: number; country?: string },
  ): SanctionsHit {
    // Deduplicate: if there's already an active hit for this entity+list+name,
    // return the existing one instead of creating a duplicate.
    const dedupeKey = `${entityId}|${match.list}|${match.name}`;
    const existingId = this.dedupe.get(dedupeKey);
    if (existingId) {
      const existing = this.hits.get(existingId);
      if (existing) return existing;
    }

    const id = uid('sanc');
    const hit: SanctionsHit = {
      id,
      entityId,
      list: match.list,
      matchedName: match.name,
      matchedEntry: match.entry,
      // Canonical matcher returns 0-100; the legacy contract is 0-1.
      score: Number((match.score / 100).toFixed(4)),
      createdAt: nowTs(),
    };
    this.hits.set(id, hit);
    this.dedupe.set(dedupeKey, id);
    return hit;
  }
}

// ---------------------------------------------------------------------------
// Re-export the canonical matcher for callers that want to skip the wrapper
// and hit the canonical stack directly.
// ---------------------------------------------------------------------------

export { matchSanctionsName } from '@/trust/sanctions-screener';

/**
 * Map a canonical `src/trust` `SanctionsList` (uppercase) to the legacy
 * `src/protocol/compliance` `SanctionsList` (lowercase). The two stacks
 * use different enum casing for historical reasons — the wrapper bridges.
 */
function mapTrustListToProtocol(list: import('@/trust/types').SanctionsList): SanctionsList {
  switch (list) {
    case 'OFAC':
      return 'ofac';
    case 'EU':
      return 'eu';
    case 'UN':
      return 'un';
    case 'HMT':
      return 'uk_hmt';
    case 'internal_watchlist':
      return 'custom';
  }
}

// ---------------------------------------------------------------------------
// Levenshtein + Jaccard helpers — kept here for backwards-compat with any
// code that imported them directly. They are NOT used by this wrapper
// (the wrapper delegates to `matchSanctionsName`), but legacy importers
// may still depend on them being exported from this module.
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
