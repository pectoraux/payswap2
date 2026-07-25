/**
 * PaySwap Protocol — Collateral Vault Module.
 *
 * Separate from liquidity. Secures manual settlement obligations.
 * Collateral is slashed ONLY after protocol adjudication.
 * Collateral is NEVER used as routing liquidity.
 *
 * Lifecycle:
 *   locked → (released | partially_slashed → (slashed | released) | slashed)
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';

export type CollateralState = 'locked' | 'released' | 'slashed' | 'partially_slashed';

export interface CollateralEntry {
  id: string;
  lpId: string;
  amount: number;
  currency: string;
  state: CollateralState;
  lockedAt: number;
  releasedAt: number | null;
  slashReason: string | null;
  slashAmount: number;
  remainingAmount: number;
  history: { from: CollateralState; to: CollateralState; action: string; ts: number; reason: string }[];
}

const ALLOWED: Record<CollateralState, string[]> = {
  locked: ['release', 'slash'],
  partially_slashed: ['release', 'slash'],
  released: [],
  slashed: [],
};

export class CollateralVault {
  private entries: Map<string, CollateralEntry> = new Map();

  /** Lock collateral for an LP. */
  lock(lpId: string, amount: number, currency: string): CollateralEntry {
    const entry: CollateralEntry = {
      id: uid('collat'),
      lpId, amount, currency,
      state: 'locked',
      lockedAt: Date.now(),
      releasedAt: null,
      slashReason: null,
      slashAmount: 0,
      remainingAmount: amount,
      history: [],
    };
    this.entries.set(entry.id, entry);
    entry.history.push({ from: 'locked', to: 'locked', action: 'lock', ts: Date.now(), reason: `Collateral locked for ${lpId}` });
    eventEngine.emit('collateral.locked', { collateralId: entry.id, lpId, amount, currency }, 0);
    return entry;
  }

  /** Slash collateral (after adjudication). */
  slash(collateralId: string, slashAmount: number, reason: string): CollateralEntry | null {
    const entry = this.entries.get(collateralId);
    if (!entry || !ALLOWED[entry.state]?.includes('slash')) return null;
    const actualSlash = Math.min(slashAmount, entry.remainingAmount);
    entry.slashAmount = round(entry.slashAmount + actualSlash, 6);
    entry.remainingAmount = round(entry.amount - entry.slashAmount, 6);
    entry.slashReason = reason;
    const oldState = entry.state;
    entry.state = entry.remainingAmount <= 0 ? 'slashed' : 'partially_slashed';
    entry.history.push({ from: oldState, to: entry.state, action: 'slash', ts: Date.now(), reason: `Slashed ${actualSlash} — ${reason}` });
    eventEngine.emit('collateral.slashed', { collateralId, lpId: entry.lpId, slashAmount: actualSlash, reason, remaining: entry.remainingAmount }, 0);
    return entry;
  }

  /** Release collateral (obligation fulfilled, no slash needed). */
  release(collateralId: string): CollateralEntry | null {
    const entry = this.entries.get(collateralId);
    if (!entry || !ALLOWED[entry.state]?.includes('release')) return null;
    const oldState = entry.state;
    entry.state = 'released';
    entry.releasedAt = Date.now();
    entry.history.push({ from: oldState, to: 'released', action: 'release', ts: Date.now(), reason: 'Collateral released — obligation fulfilled' });
    eventEngine.emit('collateral.released', { collateralId, lpId: entry.lpId, remaining: entry.remainingAmount }, 0);
    return entry;
  }

  /** Increase collateral (LP adds more). */
  increase(collateralId: string, additionalAmount: number): CollateralEntry | null {
    const entry = this.entries.get(collateralId);
    if (!entry || entry.state !== 'locked') return null;
    entry.amount = round(entry.amount + additionalAmount, 6);
    entry.remainingAmount = round(entry.remainingAmount + additionalAmount, 6);
    entry.history.push({ from: 'locked', to: 'locked', action: 'increase', ts: Date.now(), reason: `Increased by ${additionalAmount}` });
    eventEngine.emit('collateral.increased', { collateralId, lpId: entry.lpId, additionalAmount, newTotal: entry.amount }, 0);
    return entry;
  }

  get(collateralId: string): CollateralEntry | undefined { return this.entries.get(collateralId); }
  byLp(lpId: string): CollateralEntry[] { return [...this.entries.values()].filter((e) => e.lpId === lpId); }
  all(): CollateralEntry[] { return [...this.entries.values()]; }

  /** Total locked collateral for an LP. */
  totalLockedByLp(lpId: string): number {
    return this.byLp(lpId)
      .filter((e) => e.state === 'locked' || e.state === 'partially_slashed')
      .reduce((sum, e) => sum + e.remainingAmount, 0);
  }

  reset(): void { this.entries.clear(); }
}

export const collateralVault = new CollateralVault();
