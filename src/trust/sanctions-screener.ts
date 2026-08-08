/**
 * Sanctions Screener — CANONICAL sanctions screening service. (M-TRUST-40, P3-4 / H-8 fix.)
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  CANONICAL COMPLIANCE STACK — this module is the single source of     ║
 * ║  truth for sanctions screening in PaySwap. The legacy in-memory      ║
 * ║  stack at `src/protocol/compliance/sanctions.ts` is now a thin       ║
 * ║  wrapper that delegates matching to THIS module.                     ║
 * ║                                                                       ║
 * ║  DO NOT extend the legacy stack directly. New sanctions-related      ║
 * ║  code should import from `@/trust/sanctions-screener` (here) or      ║
 * ║  `@/trust` (the index).                                              ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Screens entity names against multiple sanctions lists:
 *   - OFAC (US Treasury Office of Foreign Assets Control)
 *   - UN (United Nations Security Council)
 *   - EU (European Union Consolidated List)
 *   - HMT (UK HM Treasury)
 *   - internal_watchlist (PaySwap's own watchlist)
 *
 * Uses Levenshtein distance for fuzzy matching. Match score is the
 * similarity percentage (0-100, higher = more similar).
 *
 * ── Sanctions feed ───────────────────────────────────────────────────────
 * The list is loaded from `data/dev-sanctions-fixture.json` by default
 * (a 14-name DEV sample). In production, set `PAYSWAP_SANCTIONS_LIST_FILE`
 * to a JSON file refreshed daily from a real feed (Chainalysis KYT, TRM
 * Labs, Refinitiv World-Check One, Dow Jones R&C). See
 * `src/trust/sanctions-list-loader.ts` for the loader contract.
 *
 * ── Persistence ──────────────────────────────────────────────────────────
 * Screenings are persisted to the `ComplianceReview` Prisma table
 * (type='SANCTIONS') so they survive a process restart. Use `listScreenings()`
 * to read from the in-memory cache (fast) or query the DB directly for the
 * full history.
 */

import type { SanctionsScreening, SanctionsList } from './types';
import { uid } from '@/runtime/types';
import {
  loadSanctionsList,
  type SanctionsListId,
} from './sanctions-list-loader';
import { db } from '@/lib/db';

// ─── Internal watchlist (PaySwap's own additions, runtime-mutable) ──────────

/** PaySwap's internal watchlist — runtime-mutable via `addToWatchlist()`. */
const INTERNAL_WATCHLIST: string[] = [];

// ─── Levenshtein distance ────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
    }
  }

  return d[m][n];
}

/**
 * Compute similarity score (0-100, higher = more similar).
 */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  const dist = levenshtein(a, b);
  return Math.round((1 - dist / maxLen) * 100);
}

// ─── Sync matcher (shared with the protocol/compliance wrapper) ────────────

/**
 * Result of a single name-match attempt against one list entry.
 * Exported so the legacy `src/protocol/compliance/sanctions.ts` wrapper
 * can call into the SAME matcher (no duplicated Levenshtein/Jaccard logic).
 */
export interface SanctionsNameMatch {
  list: SanctionsList;
  name: string;
  entry: string;
  /** 0-100 similarity score (higher = more similar). */
  score: number;
  country?: string;
}

/**
 * Sync fuzzy-match a name against every entry in every loaded sanctions
 * list. Returns ALL entries (above or below threshold), sorted by score
 * descending. The caller is responsible for applying its own threshold.
 *
 * This is the single matcher used by:
 *   - `SanctionsScreener.screen()` (canonical, async, persists to DB)
 *   - `src/protocol/compliance/sanctions.ts` `screenEntity()` (legacy wrapper, sync)
 *
 * Keeping one matcher means a payout blocked at the constitution guard
 * and a payout blocked at the policy stage see the SAME answer.
 *
 * @param name     The entity name to screen.
 * @param minScore Optional lower-bound score (0-100) to filter the result.
 *                 Default 0 (return all entries, sorted by score desc).
 */
export function matchSanctionsName(name: string, minScore = 0): SanctionsNameMatch[] {
  const query = (name ?? '').toUpperCase().trim();
  const out: SanctionsNameMatch[] = [];

  // 1. Loader entries (file-backed — the canonical source).
  for (const e of loadSanctionsList()) {
    const score = similarity(query, e.name.toUpperCase().trim());
    if (score >= minScore) {
      out.push({
        list: mapListIdToTrust(e.list),
        name: e.name,
        entry: e.entry,
        score,
        country: e.country,
      });
    }
  }

  // 2. Runtime-mutable internal watchlist (`addToWatchlist()`).
  for (const candidate of INTERNAL_WATCHLIST) {
    const score = similarity(query, candidate.toUpperCase().trim());
    if (score >= minScore) {
      out.push({
        list: 'internal_watchlist' as SanctionsList,
        name: candidate,
        entry: candidate,
        score,
      });
    }
  }

  // Deduplicate by `${list}:${name}` (keep the highest score).
  const seen = new Map<string, SanctionsNameMatch>();
  for (const m of out) {
    const key = `${m.list}:${m.name}`;
    const prev = seen.get(key);
    if (!prev || m.score > prev.score) seen.set(key, m);
  }
  return [...seen.values()].sort((a, b) => b.score - a.score);
}

/** Map a loader `SanctionsListId` (lowercase) to the trust `SanctionsList` (uppercase). */
function mapListIdToTrust(id: SanctionsListId): SanctionsList {
  switch (id) {
    case 'ofac':
      return 'OFAC';
    case 'eu':
      return 'EU';
    case 'un':
      return 'UN';
    case 'uk_hmt':
      return 'HMT';
    case 'custom':
      return 'internal_watchlist';
  }
}

export class SanctionsScreener {
  private screenings: Map<string, SanctionsScreening> = new Map();

  /**
   * Screen a name against all sanctions lists.
   *
   * Async because it persists the screening record to the `ComplianceReview`
   * Prisma table (type='SANCTIONS') so it survives a process restart.
   * Best-effort persistence: a DB write failure does NOT fail the screen —
   * the in-memory record is still returned.
   */
  async screen(name: string, entityId: string): Promise<SanctionsScreening> {
    const matches = matchSanctionsName(name);
    const bestMatch = matches[0] ?? null;

    const screening: SanctionsScreening = {
      id: uid('san'),
      entityId,
      entityName: name,
      matchedName: bestMatch?.name ?? '',
      matchedList: bestMatch?.list ?? 'internal_watchlist',
      matchScore: bestMatch?.score ?? 0,
      status: bestMatch && bestMatch.score >= 85 ? 'pending' : 'false_positive',
      screenedAt: Date.now(),
    };

    this.screenings.set(screening.id, screening);

    // Best-effort persist to DB (P3-4 / H-8: survive restart).
    try {
      await db.complianceReview.create({
        data: {
          id: screening.id,
          entityType: 'CUSTOMER',
          entityId,
          type: 'SANCTIONS',
          status: screening.status.toUpperCase(),
          data: JSON.stringify({
            entityName: name,
            matchedName: screening.matchedName,
            matchedList: screening.matchedList,
            matchScore: screening.matchScore,
            screenedAt: screening.screenedAt,
          }),
        },
      });
    } catch (err) {
      // Don't fail the screen — log + continue.
      console.error('[SanctionsScreener] DB persist failed (returning in-memory result):', err);
    }

    return screening;
  }

  /**
   * Batch screen multiple entities.
   */
  async screenBatch(
    entities: { name: string; id: string }[],
  ): Promise<SanctionsScreening[]> {
    const results: SanctionsScreening[] = [];
    for (const e of entities) {
      results.push(await this.screen(e.name, e.id));
    }
    return results;
  }

  /**
   * Add a name to the internal watchlist.
   */
  addToWatchlist(name: string): void {
    INTERNAL_WATCHLIST.push(name);
  }

  /**
   * List all screenings.
   */
  listScreenings(filter?: {
    status?: string;
    list?: string;
    limit?: number;
  }): SanctionsScreening[] {
    let results = Array.from(this.screenings.values());
    if (filter?.status) {
      results = results.filter((s) => s.status === filter.status);
    }
    if (filter?.list) {
      results = results.filter((s) => s.matchedList === filter.list);
    }
    results.sort((a, b) => b.screenedAt - a.screenedAt);
    return results.slice(0, filter?.limit ?? 100);
  }

  /**
   * Resolve a screening (true/false positive).
   */
  resolve(
    screeningId: string,
    status: 'true_positive' | 'false_positive' | 'review',
    resolvedBy: string,
    notes?: string,
  ): SanctionsScreening | null {
    const screening = this.screenings.get(screeningId);
    if (!screening) return null;

    screening.status = status;
    screening.resolvedAt = Date.now();
    screening.resolvedBy = resolvedBy;
    screening.notes = notes;

    // Best-effort persist the resolution to DB.
    db.complianceReview
      .update({
        where: { id: screeningId },
        data: {
          status: status.toUpperCase(),
          reviewerId: resolvedBy,
          reviewedAt: new Date(),
          notes,
        },
      })
      .catch((err: unknown) => {
        console.error('[SanctionsScreener] DB resolve-update failed:', err);
      });

    return screening;
  }

  /**
   * Get stats.
   */
  getStats(): {
    total: number;
    pending: number;
    truePositives: number;
    falsePositives: number;
  } {
    const all = Array.from(this.screenings.values());
    return {
      total: all.length,
      pending: all.filter((s) => s.status === 'pending').length,
      truePositives: all.filter((s) => s.status === 'true_positive').length,
      falsePositives: all.filter((s) => s.status === 'false_positive').length,
    };
  }
  /**
   * Alias for listScreenings (backward compat).
   */
  list(filter?: { status?: string; list?: string; limit?: number }): SanctionsScreening[] {
    return this.listScreenings(filter);
  }

  /**
   * Get a single screening by ID.
   */
  get(screeningId: string): SanctionsScreening | null {
    return this.screenings.get(screeningId) ?? null;
  }

  /**
   * Alias for getStats (backward compat).
   */
  stats(): { total: number; pending: number; truePositives: number; falsePositives: number } {
    return this.getStats();
  }
}

export const sanctionsScreener = new SanctionsScreener();
