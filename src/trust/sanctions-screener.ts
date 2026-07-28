/**
 * Sanctions Screener — fuzzy name matching against watchlists. (M-TRUST-40.)
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
 */

import type { SanctionsScreening, SanctionsList } from './types';
import { uid } from '@/runtime/types';

// ─── Mock sanctions lists (in production, fetched from regulators) ──────────

const OFAC_ENTRIES = [
  'AL-ZAWAHIRI, Ayman',
  'BIN LADEN, Osama',
  'GADDAFI, Muammar',
  'ASSAD, Bashar',
  'KIM JONG UN',
  'NASRALLAH, Hassan',
  'SOLEIMANI, Qasem',
  'MUGABE, Robert',
  'BASHIR, Omar',
  'PUTIN, Vladimir',
  'LAVROV, Sergey',
  'SECHIN, Igor',
];

const UN_ENTRIES = [
  'AL-BASHIR, Omar',
  'GADDAFI, Saif',
  'ASSAD, Maher',
  'KIM JONG NAM',
  'NASRALLAH, Hassan',
  'SADR, Muqtada',
];

const EU_ENTRIES = [
  'PUTIN, Vladimir',
  'LAVROV, Sergey',
  'MISHUSTIN, Mikhail',
  'SOLOVYOV, Vladimir',
  'MARGOLOV, Vladimir',
];

const HMT_ENTRIES = [
  'ASSAD, Bashar',
  'MAHER, Assad',
  'GADDAFI, Khamis',
  'MUBARAK, Hosni',
];

const INTERNAL_WATCHLIST: string[] = [];

const LISTS: Record<SanctionsList, string[]> = {
  OFAC: OFAC_ENTRIES,
  UN: UN_ENTRIES,
  EU: EU_ENTRIES,
  HMT: HMT_ENTRIES,
  internal_watchlist: INTERNAL_WATCHLIST,
};

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

export class SanctionsScreener {
  private screenings: Map<string, SanctionsScreening> = new Map();

  /**
   * Screen a name against all sanctions lists.
   */
  async screen(name: string, entityId: string): Promise<SanctionsScreening> {
    let bestMatch: { name: string; list: SanctionsList; score: number } | null = null;

    for (const [listName, entries] of Object.entries(LISTS)) {
      for (const entry of entries) {
        const score = similarity(name, entry);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { name: entry, list: listName as SanctionsList, score };
        }
      }
    }

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
