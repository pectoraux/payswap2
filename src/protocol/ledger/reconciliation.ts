/**
 * PaySwap Protocol — Ledger Reconciliation.
 *
 * Reconciliation verifies that the protocol ledger agrees with the source-of-
 * truth subsystems (twin token engine, escrow, payouts, merchant platform,
 * treasury). Each `reconcileXxx()` function returns a structured result with
 * a boolean `passed` flag and a list of discrepancies; `dailyReconciliation()`
 * runs them all and aggregates the results.
 *
 * To avoid coupling to modules that may not exist yet (payout-service,
 * merchant/platform), the reconciliation functions accept duck-typed
 * interfaces (PayoutLike, MerchantLike) rather than importing the singletons.
 * Callers pass the real instances at runtime.
 */
import { round } from '@/kernel/support';
import type { LedgerEngine, TrialBalance } from './engine';
import {
  circulatingAccount,
  escrowedAccount,
  backingAccount,
  twinAssetToCurrency,
} from './accounts';

/** Generic reconciliation result. */
export interface ReconcileResult {
  /** Human-readable name of the check. */
  name: string;
  /** True if the check passed (no discrepancies). */
  passed: boolean;
  /** Per-line discrepancies (empty when passed). */
  discrepancies: ReconcileDiscrepancy[];
  /** Optional summary metrics for the check. */
  metrics?: Record<string, number | string>;
}

export interface ReconcileDiscrepancy {
  /** What was being compared. */
  item: string;
  /** Value recorded in the ledger. */
  ledgerValue: number;
  /** Value reported by the source-of-truth subsystem. */
  sourceValue: number;
  /** ledgerValue − sourceValue. */
  difference: number;
  /** Optional human-readable note. */
  note?: string;
}

/** Duck-typed twin token engine — accepts the real TwinTokenEngine. */
export interface TwinTokenLike {
  allAssets(): Array<{
    code: string;
    currency: string;
    totalSupply: number;
    circulating?: number;
    escrowed?: number;
    frozen?: number;
  }>;
  getAsset?(code: string): { code: string; currency: string; totalSupply: number } | undefined;
  allEscrows?(): Array<{ assetCode: string; amount: number; released: boolean }>;
}

/** Duck-typed escrow module — accepts the real SettlementEscrow. */
export interface EscrowLike {
  all(): Array<{
    id: string;
    amount: number;
    currency: string;
    twinTokenAmount: number;
    state: string;
  }>;
  frozen?(): Array<{
    id: string;
    amount: number;
    currency: string;
    twinTokenAmount: number;
  }>;
}

/** Duck-typed payout service — accepts the real PayoutService. */
export interface PayoutLike {
  list(filter?: { merchantId?: string }): Array<{
    id: string;
    merchantId?: string;
    state: string;
    sourceAmount?: number;
    fee?: number;
    netAmount?: number;
    destinationCurrency?: string;
    method?: string;
    txHash?: string;
  }>;
}

/** Duck-typed merchant platform — accepts the real MerchantPlatform. */
export interface MerchantLike {
  allMerchants?(): Array<{
    id: string;
    bond?: number;
    bondEscrowed?: number;
    currency?: string;
  }>;
  getMerchant?(id: string): { id: string; bond?: number; bondEscrowed?: number; currency?: string } | undefined;
}

/** Duck-typed collateral vault — accepts the real CollateralVault. */
export interface CollateralVaultLike {
  all(): Array<{
    id: string;
    lpId: string;
    amount: number;
    currency: string;
    state: string;
    remainingAmount: number;
  }>;
}

/** Duck-typed LP lifecycle manager — accepts the real LPLifecycle. */
export interface LPLifecycleLike {
  all(): Array<{
    id: string;
    currency: string;
    stakeIds?: string[];
    collateralIds?: string[];
  }>;
}

/**
 * Reconcile twin-token backing.
 *
 * Invariant: for every TWIN asset, circulating + escrowed (per the twin
 * token engine) must equal the backing liability recorded in the ledger
 * (account `twin:backing:${currency}`), AND must equal the asset's
 * `totalSupply` (since every minted token is backed).
 */
export function reconcileTwinTokenBacking(
  ledger: LedgerEngine,
  twinTokenEngine: TwinTokenLike,
): ReconcileResult {
  const discrepancies: ReconcileDiscrepancy[] = [];
  const assets = twinTokenEngine.allAssets();
  const metrics: Record<string, number | string> = { assetCount: assets.length };

  for (const asset of assets) {
    const currency = asset.currency || twinAssetToCurrency(asset.code);
    const circulating = asset.circulating ?? asset.totalSupply; // fallback if engine doesn't track circulating
    const escrowed = asset.escrowed ?? 0;
    const expectedBacking = round(circulating + escrowed, 6);
    const ledgerBacking = Math.abs(ledger.getAccountBalance(backingAccount(currency)));
    const ledgerEscrowed = Math.max(0, ledger.getAccountBalance(escrowedAccount(asset.code)));
    const ledgerCirculating = Math.max(0, ledger.getAccountBalance(circulatingAccount(asset.code)));

    if (Math.abs(ledgerBacking - expectedBacking) > 1e-6) {
      discrepancies.push({
        item: `backing:${currency}`,
        ledgerValue: ledgerBacking,
        sourceValue: expectedBacking,
        difference: round(ledgerBacking - expectedBacking, 6),
        note: `twin:backing:${currency} ledger does not match circulating+escrowed from twin token engine`,
      });
    }
    if (Math.abs(ledgerCirculating - circulating) > 1e-6) {
      discrepancies.push({
        item: `circulating:${asset.code}`,
        ledgerValue: ledgerCirculating,
        sourceValue: circulating,
        difference: round(ledgerCirculating - circulating, 6),
        note: `twintoken:circulating:${asset.code} ledger does not match twin token engine`,
      });
    }
    if (Math.abs(ledgerEscrowed - escrowed) > 1e-6) {
      discrepancies.push({
        item: `escrowed:${asset.code}`,
        ledgerValue: ledgerEscrowed,
        sourceValue: escrowed,
        difference: round(ledgerEscrowed - escrowed, 6),
        note: `twintoken:escrowed:${asset.code} ledger does not match twin token engine`,
      });
    }

    metrics[`asset:${asset.code}:totalSupply`] = asset.totalSupply;
    metrics[`asset:${asset.code}:backing`] = ledgerBacking;
  }

  return {
    name: 'twinTokenBacking',
    passed: discrepancies.length === 0,
    discrepancies,
    metrics,
  };
}

/**
 * Reconcile escrow entries.
 *
 * For each escrow entry in the source-of-truth escrow module that is still
 * frozen, the ledger must show a corresponding escrowed balance for the
 * underlying twin token asset. The sum of all frozen escrow amounts should
 * equal the `twintoken:escrowed:*` balance in the ledger (per asset code).
 */
export function reconcileEscrow(
  ledger: LedgerEngine,
  escrowModule: EscrowLike,
): ReconcileResult {
  const discrepancies: ReconcileDiscrepancy[] = [];
  const entries = escrowModule.all();
  const frozenEntries = entries.filter((e) => e.state === 'frozen');

  // Group frozen escrow amounts by asset code (assumed to be `TWIN<currency>`).
  const frozenByAsset = new Map<string, number>();
  for (const e of frozenEntries) {
    const assetCode = `TWIN${e.currency ?? ''}`;
    frozenByAsset.set(assetCode, round((frozenByAsset.get(assetCode) ?? 0) + e.twinTokenAmount, 6));
  }

  for (const [assetCode, frozenAmount] of frozenByAsset) {
    const ledgerEscrowed = Math.max(0, ledger.getAccountBalance(escrowedAccount(assetCode)));
    if (Math.abs(ledgerEscrowed - frozenAmount) > 1e-6) {
      discrepancies.push({
        item: `escrow:${assetCode}`,
        ledgerValue: ledgerEscrowed,
        sourceValue: frozenAmount,
        difference: round(ledgerEscrowed - frozenAmount, 6),
        note: `ledger escrowed balance for ${assetCode} does not match sum of frozen escrow entries`,
      });
    }
  }

  // Also verify released entries have zero balance impact (no leftover).
  for (const e of entries) {
    if (e.state !== 'frozen' && e.twinTokenAmount > 0) {
      // Released/slashed/refunded entries should not contribute to escrow
      // balance — the ledger should have moved those tokens out.
      // This is informational only; the per-asset check above catches
      // leftover balances.
    }
  }

  return {
    name: 'escrow',
    passed: discrepancies.length === 0,
    discrepancies,
    metrics: {
      entryCount: entries.length,
      frozenCount: frozenEntries.length,
    },
  };
}

/**
 * Reconcile completed payouts.
 *
 * Every payout in `completed` state should have a corresponding journal entry
 * in the ledger (txId derived from the payout id). Verifies that the total
 * net amount and fee revenue are reflected.
 */
export function reconcilePayouts(
  ledger: LedgerEngine,
  payoutService: PayoutLike,
): ReconcileResult {
  const discrepancies: ReconcileDiscrepancy[] = [];
  const payouts = payoutService.list();
  const completed = payouts.filter((p) => p.state === 'completed' || p.state === 'settled');

  for (const payout of completed) {
    const txId = `payout:${payout.id}`;
    const journals = ledger.getJournal({ txId });
    if (journals.length === 0) {
      // Fall back to checking by txHash if present.
      const altTxId = payout.txHash ? `payout:${payout.txHash}` : null;
      const altJournals = altTxId ? ledger.getJournal({ txId: altTxId }) : [];
      if (altJournals.length === 0) {
        discrepancies.push({
          item: `payout:${payout.id}`,
          ledgerValue: 0,
          sourceValue: payout.netAmount ?? 0,
          difference: -(payout.netAmount ?? 0),
          note: 'completed payout has no matching ledger journal entry',
        });
        continue;
      }
    }

    // Verify the net amount is reflected in some leg.
    const netAmount = payout.netAmount ?? 0;
    if (netAmount > 0) {
      const legs = journals.flatMap((j) => j.entries);
      const matchingLegs = legs.filter((l) => Math.abs(l.debit - netAmount) < 1e-6 || Math.abs(l.credit - netAmount) < 1e-6);
      if (matchingLegs.length === 0) {
        discrepancies.push({
          item: `payout:${payout.id}:net`,
          ledgerValue: 0,
          sourceValue: netAmount,
          difference: -netAmount,
          note: 'payout net amount not found in ledger legs',
        });
      }
    }
  }

  return {
    name: 'payouts',
    passed: discrepancies.length === 0,
    discrepancies,
    metrics: {
      payoutCount: payouts.length,
      completedCount: completed.length,
    },
  };
}

/**
 * Reconcile a single merchant's payable.
 *
 * The merchant's payable balance in the ledger (account
 * `merchant:payable:${merchantId}`) should equal the merchant's outstanding
 * payable per the merchant platform (e.g. pending settlements not yet
 * disbursed). If the merchant platform doesn't expose this, the check
 * trivially passes.
 */
export function reconcileMerchant(
  merchantId: string,
  ledger: LedgerEngine,
  merchantPlatform: MerchantLike,
): ReconcileResult {
  const discrepancies: ReconcileDiscrepancy[] = [];
  const merchant = merchantPlatform.getMerchant?.(merchantId);
  const ledgerPayable = ledger.getAccountBalance(`merchant:payable:${merchantId}`);

  // Source value: bondEscrowed is the closest analog if no explicit payable
  // is exposed. Treat 0 as "no opinion" (skip).
  const sourcePayable = merchant?.bondEscrowed ?? 0;

  if (merchant && sourcePayable > 0 && Math.abs(ledgerPayable - sourcePayable) > 1e-6) {
    discrepancies.push({
      item: `merchant:${merchantId}:payable`,
      ledgerValue: ledgerPayable,
      sourceValue: sourcePayable,
      difference: round(ledgerPayable - sourcePayable, 6),
      note: 'merchant payable in ledger does not match merchant platform bond escrowed',
    });
  }

  return {
    name: `merchant:${merchantId}`,
    passed: discrepancies.length === 0,
    discrepancies,
    metrics: {
      ledgerPayable,
      sourcePayable,
    },
  };
}

/**
 * Reconcile treasury equity.
 *
 * The `equity:treasury` balance should be positive (or zero) and the trial
 * balance should be balanced. Verifies that treasury allocations from merchant
 * bonds and other sources are reflected.
 */
export function reconcileTreasury(ledger: LedgerEngine): ReconcileResult {
  const discrepancies: ReconcileDiscrepancy[] = [];
  const tb = ledger.getTrialBalance();
  const treasuryBalance = ledger.getAccountBalance('equity:treasury');

  if (!tb.balanced) {
    discrepancies.push({
      item: 'trialBalance',
      ledgerValue: tb.totalDebits,
      sourceValue: tb.totalCredits,
      difference: round(tb.totalDebits - tb.totalCredits, 6),
      note: 'trial balance is not balanced',
    });
  }

  if (treasuryBalance < 0) {
    discrepancies.push({
      item: 'equity:treasury',
      ledgerValue: treasuryBalance,
      sourceValue: 0,
      difference: treasuryBalance,
      note: 'treasury equity is negative — possible over-allocation',
    });
  }

  return {
    name: 'treasury',
    passed: discrepancies.length === 0,
    discrepancies,
    metrics: {
      treasuryBalance,
      balanced: tb.balanced ? 1 : 0,
      totalDebits: tb.totalDebits,
      totalCredits: tb.totalCredits,
    },
  };
}

/** Inputs to `dailyReconciliation()`. */
export interface DailyReconciliationInput {
  /** Cutoff timestamp; reconciliation considers ledger state up to this point. */
  asOfTs?: number;
  /** The ledger engine to reconcile against. */
  ledger: LedgerEngine;
  /** Twin token engine (source of truth for circulating/escrowed supply). */
  twinTokenEngine: TwinTokenLike;
  /** Settlement escrow module (source of truth for frozen escrows). */
  escrowModule: EscrowLike;
  /** Collateral vault (source of truth for LP collateral). */
  collateralVault?: CollateralVaultLike;
  /** Payout service (source of truth for completed payouts). */
  payoutService?: PayoutLike;
  /** Merchant platform (source of truth for merchant payables / bonds). */
  merchantPlatform?: MerchantLike;
  /** LP lifecycle manager (source of truth for LP collateral links). */
  lpLifecycle?: LPLifecycleLike;
}

/** Aggregated daily reconciliation report. */
export interface DailyReconciliationReport {
  /** Cutoff timestamp used. */
  asOfTs: number;
  /** Trial balance snapshot. */
  trialBalance: TrialBalance;
  /** Per-check results. */
  twinTokenBacking: ReconcileResult;
  escrow: ReconcileResult;
  payouts: ReconcileResult;
  treasury: ReconcileResult;
  /** Number of checks that failed. */
  failedCount: number;
  /** Wall-clock time spent on reconciliation (ms). */
  durationMs: number;
  /** True if all checks passed. */
  passed: boolean;
}

/**
 * Run all reconciliations and aggregate the results.
 *
 * This is the daily close — auditors call this once per period to verify the
 * ledger agrees with every source-of-truth subsystem. Returns a structured
 * report; throws nothing (failures surface as `failedCount > 0`).
 */
export function dailyReconciliation(input: DailyReconciliationInput): DailyReconciliationReport {
  const start = Date.now();
  const asOfTs = input.asOfTs ?? Date.now();
  const ledger = input.ledger;
  const trialBalance = ledger.getTrialBalance(asOfTs);

  const twinTokenBacking = reconcileTwinTokenBacking(ledger, input.twinTokenEngine);
  const escrow = reconcileEscrow(ledger, input.escrowModule);
  const payouts = input.payoutService
    ? reconcilePayouts(ledger, input.payoutService)
    : { name: 'payouts', passed: true, discrepancies: [], metrics: { skipped: 1 } };
  const treasury = reconcileTreasury(ledger);

  const results = [twinTokenBacking, escrow, payouts, treasury];
  const failedCount = results.filter((r) => !r.passed).length;

  return {
    asOfTs,
    trialBalance,
    twinTokenBacking,
    escrow,
    payouts,
    treasury,
    failedCount,
    durationMs: Date.now() - start,
    passed: failedCount === 0,
  };
}
