/**
 * PaySwap Protocol — Double-Entry Ledger / Report Generators.
 * -----------------------------------------------------------------------------
 * Each report is a pure function that pulls from the ledger (rebuilt from
 * events) plus the relevant protocol module singletons. Reports are
 * serializable (no class instances, no functions) so they can be returned
 * directly from API routes.
 *
 * Reports:
 *   - SettlementReport           — period settlement summary
 *   - TreasuryReport             — point-in-time treasury position
 *   - LPReport                   — LP health + utilization
 *   - MerchantReport             — merchant revenue / payouts / outstanding
 *   - OutstandingLiabilitiesReport — what we currently owe
 *   - HistoricalSnapshotReport   — time-series of balance sheets
 */
import { round } from '@/kernel/support';
import type { LedgerEngine } from './engine';
import type { SnapshotStore, LedgerSnapshot } from './snapshots';
import { takeSnapshot } from './snapshots';

const EPSILON = 1e-6;

/* ========================================================================== */
/* Settlement Report                                                           */
/* ========================================================================== */

export interface SettlementReport {
  period: { fromTs: number; toTs: number };
  totalSettled: number;
  byCurrency: Record<string, number>;
  byLP: Record<string, number>;
  byCorridor: Record<string, number>;
  failedCount: number;
  /** Average settlement latency in ms (estimated from escrow freeze→release). */
  avgSettlementMs: number;
}

/**
 * Generate a settlement report for [fromTs, toTs].
 *
 * Pulls from:
 *   - ledger (cash:bank:* and cash:mmo:* credits = settled fiat out)
 *   - escrow module (frozen→released entries within the period)
 *   - payout service (completed + failed payouts)
 */
export function generateSettlementReport(
  ledger: LedgerEngine,
  escrowModule: { all: () => Array<{ state: string; frozenAt: number; releasedAt: number | null; currency: string; amount: number; lpId: string }> },
  payoutService: { list: (filter?: { state?: string }) => Array<{ state: string; method: string; sourceCurrency: string; destinationCurrency: string; sourceAmount: number; completedAt: number | null; createdAt: number }> },
  fromTs: number,
  toTs: number,
): SettlementReport {
  // Cash credits within the period = settled fiat out.
  const byCurrency: Record<string, number> = {};
  const byLP: Record<string, number> = {};
  const byCorridor: Record<string, number> = {};
  let totalSettled = 0;

  const lines = ledger.getLines({ fromTs, toTs });
  for (const line of lines) {
    if (line.accountCode.startsWith('cash:bank:') || line.accountCode.startsWith('cash:mmo:')) {
      if (line.credit > 0) {
        byCurrency[line.currency] = round((byCurrency[line.currency] ?? 0) + line.credit, 6);
        totalSettled = round(totalSettled + line.credit, 6);
      }
    }
  }

  // Escrow releases within the period.
  let releasedCount = 0;
  let totalLatency = 0;
  for (const entry of escrowModule.all()) {
    if (entry.state === 'released' && entry.releasedAt != null) {
      if (entry.releasedAt >= fromTs && entry.releasedAt <= toTs) {
        byLP[entry.lpId] = round((byLP[entry.lpId] ?? 0) + entry.amount, 6);
        totalLatency += entry.releasedAt - entry.frozenAt;
        releasedCount++;
        // Corridor = currency (simplified — a real report would use the
        // corridor from the payment intent).
        byCorridor[entry.currency] = round((byCorridor[entry.currency] ?? 0) + entry.amount, 6);
      }
    }
  }
  const avgSettlementMs = releasedCount > 0 ? round(totalLatency / releasedCount, 0) : 0;

  // Failed payouts within the period.
  let failedCount = 0;
  for (const payout of payoutService.list()) {
    if (payout.state === 'failed' && payout.createdAt >= fromTs && payout.createdAt <= toTs) {
      failedCount++;
    }
  }

  return {
    period: { fromTs, toTs },
    totalSettled,
    byCurrency,
    byLP,
    byCorridor,
    failedCount,
    avgSettlementMs,
  };
}

/* ========================================================================== */
/* Treasury Report                                                             */
/* ========================================================================== */

export interface TreasuryReport {
  asOfTs: number;
  totalReserves: number;
  byCurrency: Record<string, number>;
  twinTokenBacking: Record<string, number>;
  outstandingLiabilities: number;
  /** totalReserves / outstandingLiabilities — >1 means solvent. */
  capitalEfficiency: number;
}

/**
 * Generate a treasury report as of `asOfTs` (defaults to now).
 *
 * totalReserves = sum of cash:bank:* + cash:mmo:* + reserve:stellar:* DR balances.
 * twinTokenBacking = sum of twin:backing:* CR balances (liability to redeem).
 * outstandingLiabilities = twinTokenBacking + sum of user:wallet:* + merchant:payable:*.
 */
export function generateTreasuryReport(ledger: LedgerEngine, asOfTs: number = Date.now()): TreasuryReport {
  const codes = ledger.getAccountCodes(asOfTs);
  const byCurrency: Record<string, number> = {};
  let totalReserves = 0;
  for (const code of codes) {
    if (code.startsWith('cash:bank:') || code.startsWith('cash:mmo:') || code.startsWith('reserve:stellar:')) {
      const bal = ledger.getAccountBalance(code, asOfTs);
      // Asset → debit-normal → balance positive.
      for (const [cur, v] of Object.entries(bal.byCurrency)) {
        byCurrency[cur] = round((byCurrency[cur] ?? 0) + v.balance, 6);
        totalReserves = round(totalReserves + v.balance, 6);
      }
    }
  }

  const twinTokenBacking: Record<string, number> = {};
  let backingTotal = 0;
  for (const code of codes) {
    if (code.startsWith('twin:backing:')) {
      const bal = ledger.getAccountBalance(code, asOfTs);
      for (const [cur, v] of Object.entries(bal.byCurrency)) {
        const amt = round(-v.balance, 6); // credit-normal → negate
        if (Math.abs(amt) > EPSILON) {
          twinTokenBacking[cur] = amt;
          backingTotal = round(backingTotal + amt, 6);
        }
      }
    }
  }

  let otherLiabilities = 0;
  for (const code of codes) {
    if (code.startsWith('user:wallet:') || code.startsWith('merchant:payable:') || code.startsWith('payout:pending:')) {
      const bal = ledger.getAccountBalance(code, asOfTs);
      otherLiabilities = round(otherLiabilities - bal.balance, 6); // negate credit-normal
    }
  }
  const outstandingLiabilities = round(backingTotal + otherLiabilities, 6);
  const capitalEfficiency = outstandingLiabilities > 0 ? round(totalReserves / outstandingLiabilities, 6) : 0;

  return {
    asOfTs,
    totalReserves,
    byCurrency,
    twinTokenBacking,
    outstandingLiabilities,
    capitalEfficiency,
  };
}

/* ========================================================================== */
/* LP Report                                                                   */
/* ========================================================================== */

export interface LPReport {
  lpId: string;
  stake: number;
  collateral: number;
  authorizedExposure: number;
  currentExposure: number;
  utilization: number;
  reputation: number;
  volume: number;
  failures: number;
}

/**
 * Generate an LP report.
 *
 * stake, collateral, authorizedExposure, currentExposure, reputation come
 * from the lpLifecycle module. volume = sum of cash credits for the LP's
 * corridor within the period (best-effort). failures = count of LP-failed
 * payouts (best-effort: count of payouts by this LP's merchants that failed).
 */
export function generateLPReport(
  lpId: string,
  lpLifecycle: {
    get: (id: string) => {
      stakeIds: string[];
      collateralIds: string[];
      authorizedExposure: number;
      currentExposure: number;
      reputation: number;
      currency: string;
    } | undefined;
  },
  collateralVault: { totalLockedByLp: (id: string) => number },
  settlementCapacityVault: { capacityByLp: (id: string, currency?: string) => number },
): LPReport {
  const lp = lpLifecycle.get(lpId);
  if (!lp) {
    return {
      lpId,
      stake: 0,
      collateral: 0,
      authorizedExposure: 0,
      currentExposure: 0,
      utilization: 0,
      reputation: 0,
      volume: 0,
      failures: 0,
    };
  }
  const stake = settlementCapacityVault.capacityByLp(lpId, lp.currency);
  const collateral = collateralVault.totalLockedByLp(lpId);
  const utilization = lp.authorizedExposure > 0
    ? round(lp.currentExposure / lp.authorizedExposure, 6)
    : 0;
  return {
    lpId,
    stake,
    collateral,
    authorizedExposure: lp.authorizedExposure,
    currentExposure: lp.currentExposure,
    utilization,
    reputation: lp.reputation,
    volume: 0, // Best-effort — would need ledger tagging by LP.
    failures: 0, // Best-effort — would need payout→LP linkage.
  };
}

/* ========================================================================== */
/* Merchant Report                                                             */
/* ========================================================================== */

export interface MerchantReport {
  merchantId: string;
  revenue: number;
  payouts: number;
  outstanding: number;
  refundRate: number;
  feeContribution: number;
}

/**
 * Generate a merchant report.
 *
 * revenue, refundRate come from merchantPlatform.getAnalytics.
 * payouts = sum of completed payout sourceAmounts.
 * outstanding = revenue − payouts (what we still owe the merchant).
 * feeContribution = sum of completed payout fees.
 */
export function generateMerchantReport(
  merchantId: string,
  ledger: LedgerEngine,
  merchantPlatform: { getAnalytics: (id: string) => { totalRevenue: number; refundRate: number } },
  payoutService: {
    list: (filter?: { merchantId?: string; state?: string }) => Array<{
      state: string; sourceAmount: number; fee: number;
    }>;
  },
): MerchantReport {
  const analytics = merchantPlatform.getAnalytics(merchantId);
  const completed = payoutService.list({ merchantId, state: 'completed' });
  const payouts = round(completed.reduce((s, p) => s + p.sourceAmount, 0), 6);
  const feeContribution = round(completed.reduce((s, p) => s + p.fee, 0), 6);
  const outstanding = round(analytics.totalRevenue - payouts, 6);

  return {
    merchantId,
    revenue: round(analytics.totalRevenue, 6),
    payouts,
    outstanding: Math.max(0, outstanding),
    refundRate: analytics.refundRate,
    feeContribution,
  };
}

/* ========================================================================== */
/* Outstanding Liabilities Report                                              */
/* ========================================================================== */

export interface OutstandingLiabilitiesReport {
  asOfTs: number;
  twinTokensOutstanding: number;
  pendingPayouts: number;
  pendingSettlements: number;
  escrowedFunds: number;
  total: number;
}

/**
 * Generate an outstanding-liabilities report as of `asOfTs` (defaults to now).
 *
 * twinTokensOutstanding = CR balance on twin:backing:* (liability to redeem).
 * pendingPayouts = CR balance on payout:pending:*.
 * pendingSettlements = CR balance on settlement:receivable (locked user funds).
 * escrowedFunds = DR balance on twintoken:escrowed:* (asset, but illiquid).
 */
export function generateOutstandingLiabilitiesReport(
  ledger: LedgerEngine,
  asOfTs: number = Date.now(),
): OutstandingLiabilitiesReport {
  const codes = ledger.getAccountCodes(asOfTs);
  let twinTokensOutstanding = 0;
  let pendingPayouts = 0;
  let pendingSettlements = 0;
  let escrowedFunds = 0;
  for (const code of codes) {
    const bal = ledger.getAccountBalance(code, asOfTs);
    if (code.startsWith('twin:backing:')) {
      twinTokensOutstanding = round(twinTokensOutstanding - bal.balance, 6);
    } else if (code.startsWith('payout:pending:')) {
      pendingPayouts = round(pendingPayouts - bal.balance, 6);
    } else if (code === 'settlement:receivable' || code.startsWith('settlement:receivable:')) {
      // settlement:receivable is debit-normal (an asset — the right to settle).
      // We report the absolute amount being held.
      pendingSettlements = round(pendingSettlements + Math.abs(bal.balance), 6);
    } else if (code.startsWith('twintoken:escrowed:')) {
      escrowedFunds = round(escrowedFunds + bal.balance, 6);
    }
  }
  const total = round(twinTokensOutstanding + pendingPayouts + pendingSettlements + escrowedFunds, 6);
  return {
    asOfTs,
    twinTokensOutstanding,
    pendingPayouts,
    pendingSettlements,
    escrowedFunds,
    total,
  };
}

/* ========================================================================== */
/* Historical Snapshot Report                                                  */
/* ========================================================================== */

export interface HistoricalSnapshotReport {
  snapshots: LedgerSnapshot[];
  /** Time-series of total assets per snapshot. */
  totalAssetsSeries: Array<{ ts: number; totalAssets: number }>;
  /** Time-series of total liabilities per snapshot. */
  totalLiabilitiesSeries: Array<{ ts: number; totalLiabilities: number }>;
  /** Time-series of total equity per snapshot. */
  totalEquitySeries: Array<{ ts: number; totalEquity: number }>;
  /** Time-series of trial-balance delta per snapshot. */
  trialBalanceDeltaSeries: Array<{ ts: number; delta: number }>;
}

/**
 * Generate a historical-snapshot report from a SnapshotStore.
 * Pulls all snapshots in [fromTs, toTs] and computes time-series of
 * assets / liabilities / equity / trial-balance delta.
 */
export function generateHistoricalSnapshotReport(
  snapshotStore: SnapshotStore,
  fromTs?: number,
  toTs?: number,
): HistoricalSnapshotReport {
  const snapshots = snapshotStore.list(fromTs, toTs);
  const totalAssetsSeries: Array<{ ts: number; totalAssets: number }> = [];
  const totalLiabilitiesSeries: Array<{ ts: number; totalLiabilities: number }> = [];
  const totalEquitySeries: Array<{ ts: number; totalEquity: number }> = [];
  const trialBalanceDeltaSeries: Array<{ ts: number; delta: number }> = [];
  for (const snap of snapshots) {
    let assets = 0;
    let liabilities = 0;
    let equity = 0;
    for (const [code, bal] of Object.entries(snap.accounts)) {
      // Account-type lookup — duplicated here to avoid a circular import
      // with accounts.ts at runtime (accounts.ts is pure data, but we keep
      // the lookup local for clarity).
      let type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' = 'asset';
      if (code.startsWith('cash:') || code.startsWith('twintoken:') || code.startsWith('settlement:') || code.startsWith('lp:') || code.startsWith('reserve:')) {
        type = 'asset';
      } else if (code.startsWith('user:') || code.startsWith('merchant:') || code.startsWith('payout:') || code.startsWith('twin:')) {
        type = 'liability';
      } else if (code.startsWith('equity:')) {
        type = 'equity';
      } else if (code.startsWith('revenue:')) {
        type = 'revenue';
      } else if (code.startsWith('expense:')) {
        type = 'expense';
      }
      if (type === 'asset') assets = round(assets + bal.balance, 6);
      else if (type === 'liability') liabilities = round(liabilities - bal.balance, 6);
      else if (type === 'equity') equity = round(equity - bal.balance, 6);
    }
    totalAssetsSeries.push({ ts: snap.ts, totalAssets: assets });
    totalLiabilitiesSeries.push({ ts: snap.ts, totalLiabilities: liabilities });
    totalEquitySeries.push({ ts: snap.ts, totalEquity: equity });
    trialBalanceDeltaSeries.push({
      ts: snap.ts,
      delta: round(snap.trialBalance.totalDebits - snap.trialBalance.totalCredits, 6),
    });
  }
  return {
    snapshots,
    totalAssetsSeries,
    totalLiabilitiesSeries,
    totalEquitySeries,
    trialBalanceDeltaSeries,
  };
}

/**
 * Capture a snapshot into the store as of `ts` and return it.
 * Useful for scheduled snapshot capture (e.g., daily or per-frame).
 */
export function captureSnapshot(
  ledger: LedgerEngine,
  snapshotStore: SnapshotStore,
  ts: number = Date.now(),
  frame?: number,
): LedgerSnapshot {
  const snapshot = takeSnapshot(ledger, ts, frame);
  snapshotStore.save(snapshot);
  return snapshot;
}
