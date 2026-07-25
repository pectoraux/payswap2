/**
 * PaySwap Protocol — Double-Entry Ledger / Reconciliation Engine.
 * -----------------------------------------------------------------------------
 * Reconciliation verifies that the ledger (rebuilt from events) agrees with
 * the operational state of every other protocol module:
 *
 *   - reconcileTwinTokenBacking : circulating + escrowed === backing liability
 *   - reconcileEscrow           : every escrow.frozen has a matching ledger debit
 *   - reconcilePayouts          : every completed payout has a matching journal entry
 *   - reconcileMerchant         : merchant:payable ledger balance matches reality
 *   - reconcileLP               : lp:collateral ledger balance matches collateralVault
 *   - reconcileTreasury         : equity:treasury === sum(bonds) + retained fees
 *   - dailyReconciliation       : runs ALL of the above, returns a daily report
 *
 * Each reconcile* function returns `{ reconciled: boolean; ...details }` and
 * NEVER throws — callers can chain them safely. Discrepancies are reported as
 * numeric deltas so a human or downstream alert can investigate.
 */
import { round } from '@/kernel/support';
import type { LedgerEngine } from './engine';
import { twinAssetToCurrency } from './accounts';
import type { TwinTokenEngine } from '@/protocol/twin-token/engine';
import type { SettlementEscrow } from '@/protocol/settlement/escrow';
import type { CollateralVault } from '@/protocol/settlement/collateral-vault';
import type { payoutService } from '@/protocol/payouts/payout-service';
import type { MerchantPlatform } from '@/protocol/merchant/platform';
import type { LPLifecycle } from '@/protocol/lp-lifecycle-manager';

/** PayoutService class isn't exported — derive the type from the singleton. */
type PayoutService = typeof payoutService;

const EPSILON = 1e-6;

/* ========================================================================== */
/* Twin Token Backing                                                          */
/* ========================================================================== */

export interface TwinTokenBackingReconciliation {
  reconciled: boolean;
  assets: Array<{
    code: string;
    currency: string;
    circulating: number;
    escrowed: number;
    backingLiability: number;
    /** (circulating + escrowed) − backingLiability — must be ~0. */
    discrepancy: number;
  }>;
}

/**
 * For each Twin Token asset, verify:
 *     circulating + escrowed === twin:backing liability
 *
 * The circulating and escrowed values come from the ledger (DR balances on
 * twintoken:circulating:TWINxxx and twintoken:escrowed:TWINxxx accounts).
 * The backing liability is the CR balance on twin:backing:CCY.
 */
export function reconcileTwinTokenBacking(
  ledger: LedgerEngine,
  twinTokenEngine: TwinTokenEngine,
): TwinTokenBackingReconciliation {
  const assets = twinTokenEngine.allAssets();
  const rows: TwinTokenBackingReconciliation['assets'] = [];
  let reconciled = true;

  for (const asset of assets) {
    const currency = twinAssetToCurrency(asset.code);
    const circ = ledger.getAccountBalance(`twintoken:circulating:${asset.code}`);
    const esc = ledger.getAccountBalance(`twintoken:escrowed:${asset.code}`);
    const backing = ledger.getAccountBalance(`twin:backing:${currency}`);
    const circulating = round(circ.balance, 6); // debit-normal → positive
    const escrowed = round(esc.balance, 6); // debit-normal → positive
    const backingLiability = round(-backing.balance, 6); // credit-normal → negate
    const expected = round(circulating + escrowed, 6);
    const discrepancy = round(expected - backingLiability, 6);
    if (Math.abs(discrepancy) > EPSILON) reconciled = false;
    rows.push({ code: asset.code, currency, circulating, escrowed, backingLiability, discrepancy });
  }

  return { reconciled, assets: rows };
}

/* ========================================================================== */
/* Escrow                                                                      */
/* ========================================================================== */

export interface EscrowReconciliation {
  reconciled: boolean;
  /** Every escrow entry in a "funds held" state. */
  entries: Array<{
    escrowId: string;
    transactionId: string;
    assetCode: string;
    twinTokenAmount: number;
    /** Whether a matching twintoken:escrowed debit exists for this asset. */
    ledgerCovered: boolean;
    discrepancy: number;
  }>;
  /** Total escrowed in the ledger (DR balance on twintoken:escrowed:*). */
  ledgerTotalEscrowed: number;
  /** Total escrowed in the escrow module (sum of frozen+releasing entries). */
  moduleTotalEscrowed: number;
  /** ledgerTotalEscrowed − moduleTotalEscrowed — must be ~0. */
  totalDiscrepancy: number;
}

/**
 * Verify every escrow entry in a non-terminal state (frozen/releasing) has a
 * matching twintoken:escrowed debit balance in the ledger, and that the
 * aggregate escrowed amount matches.
 *
 * Note: the escrow module tracks escrows by transaction; the ledger tracks
 * them by Twin Token asset code. We reconcile at the aggregate level and
 * flag any individual escrow whose asset code has no ledger coverage.
 */
export function reconcileEscrow(
  ledger: LedgerEngine,
  escrowModule: SettlementEscrow,
  twinTokenEngine?: TwinTokenEngine,
): EscrowReconciliation {
  const entries = escrowModule.all().filter(
    (e) => e.state === 'frozen' || e.state === 'releasing',
  );
  let moduleTotal = 0;
  const rows: EscrowReconciliation['entries'] = [];
  let reconciled = true;

  for (const entry of entries) {
    moduleTotal = round(moduleTotal + entry.twinTokenAmount, 6);
    // Determine the Twin Token asset code — either from the twin-token engine
    // (preferred) or by deriving from the escrow's currency.
    let assetCode = `TWIN${entry.currency}`;
    if (twinTokenEngine) {
      const match = twinTokenEngine.allAssets().find((a) => a.currency === entry.currency);
      if (match) assetCode = match.code;
    }
    const escBal = ledger.getAccountBalance(`twintoken:escrowed:${assetCode}`);
    const ledgerCovered = escBal.debit >= entry.twinTokenAmount - EPSILON;
    const discrepancy = round(escBal.debit - entry.twinTokenAmount, 6);
    if (!ledgerCovered) reconciled = false;
    rows.push({
      escrowId: entry.id,
      transactionId: entry.transactionId,
      assetCode,
      twinTokenAmount: entry.twinTokenAmount,
      ledgerCovered,
      discrepancy,
    });
  }

  // Aggregate check: sum every twintoken:escrowed:* account in the ledger.
  const allCodes = ledger.getAccountCodes();
  let ledgerTotal = 0;
  for (const code of allCodes) {
    if (code.startsWith('twintoken:escrowed:')) {
      const bal = ledger.getAccountBalance(code);
      ledgerTotal = round(ledgerTotal + bal.debit, 6);
    }
  }
  const totalDiscrepancy = round(ledgerTotal - moduleTotal, 6);
  if (Math.abs(totalDiscrepancy) > EPSILON) reconciled = false;

  return {
    reconciled,
    entries: rows,
    ledgerTotalEscrowed: ledgerTotal,
    moduleTotalEscrowed: moduleTotal,
    totalDiscrepancy,
  };
}

/* ========================================================================== */
/* Payouts                                                                     */
/* ========================================================================== */

export interface PayoutReconciliation {
  reconciled: boolean;
  payouts: Array<{
    payoutId: string;
    merchantId: string;
    method: string;
    sourceAmount: number;
    netAmount: number;
    fee: number;
    /** Whether a journal entry with txId === payoutId exists. */
    hasJournalEntry: boolean;
    /** Total debited to merchant:payable for this payout. */
    ledgerDebit: number;
    /** Total credited to cash + revenue:fees for this payout. */
    ledgerCredit: number;
    discrepancy: number;
  }>;
  /** Sum of sourceAmounts for completed payouts. */
  totalCompletedSource: number;
  /** Sum of fees for completed payouts. */
  totalFees: number;
  /** Sum of fee revenue in the ledger. */
  ledgerFeeRevenue: number;
}

/**
 * Verify every completed payout has a matching journal entry in the ledger,
 * and that the gross/net/fee amounts reconcile.
 */
export function reconcilePayouts(
  ledger: LedgerEngine,
  payoutService: PayoutService,
): PayoutReconciliation {
  const completed = payoutService.list({ state: 'completed' });
  const rows: PayoutReconciliation['payouts'] = [];
  let reconciled = true;
  let totalCompletedSource = 0;
  let totalFees = 0;

  for (const payout of completed) {
    totalCompletedSource = round(totalCompletedSource + payout.sourceAmount, 6);
    totalFees = round(totalFees + payout.fee, 6);

    // Find the journal entry whose txId === payout.id (or txHash if available).
    const matches = ledger.getJournal({ txId: payout.id });
    const hasJournalEntry = matches.length > 0;
    let ledgerDebit = 0;
    let ledgerCredit = 0;
    for (const j of matches) {
      for (const line of j.entries) {
        if (line.accountCode.startsWith('merchant:payable:')) {
          ledgerDebit = round(ledgerDebit + line.debit, 6);
        }
        if (line.accountCode.startsWith('cash:') || line.accountCode.startsWith('revenue:fees:')) {
          ledgerCredit = round(ledgerCredit + line.credit, 6);
        }
      }
    }
    // Expected debit = sourceAmount (the gross Twin Token amount redeemed).
    // Expected credit = netAmount (cash out) + fee (revenue).
    const expectedDebit = payout.sourceAmount;
    const expectedCredit = round(payout.netAmount + payout.fee, 6);
    const discrepancy = round(
      Math.abs(ledgerDebit - expectedDebit) + Math.abs(ledgerCredit - expectedCredit),
      6,
    );
    if (!hasJournalEntry || discrepancy > EPSILON) reconciled = false;
    rows.push({
      payoutId: payout.id,
      merchantId: payout.merchantId,
      method: payout.method,
      sourceAmount: payout.sourceAmount,
      netAmount: payout.netAmount,
      fee: payout.fee,
      hasJournalEntry,
      ledgerDebit,
      ledgerCredit,
      discrepancy,
    });
  }

  // Aggregate fee revenue across all revenue:fees:* accounts.
  const allCodes = ledger.getAccountCodes();
  let ledgerFeeRevenue = 0;
  for (const code of allCodes) {
    if (code.startsWith('revenue:fees:')) {
      const bal = ledger.getAccountBalance(code);
      // Revenue is credit-normal → balance (DR − CR) is negative; negate.
      ledgerFeeRevenue = round(ledgerFeeRevenue - bal.balance, 6);
    }
  }
  // Aggregate check: ledgerFeeRevenue should approximately equal totalFees.
  if (Math.abs(ledgerFeeRevenue - totalFees) > EPSILON) reconciled = false;

  return {
    reconciled,
    payouts: rows,
    totalCompletedSource,
    totalFees,
    ledgerFeeRevenue,
  };
}

/* ========================================================================== */
/* Merchant                                                                    */
/* ========================================================================== */

export interface MerchantReconciliation {
  merchantId: string;
  reconciled: boolean;
  /** Ledger balance of merchant:payable:merchantId (negative = DR / overpaid). */
  ledgerPayableBalance: number;
  /** Total payouts DR'd against this merchant in the ledger. */
  ledgerPayoutsTotal: number;
  /** Sum of completed payout sourceAmounts (from payoutService). */
  modulePayoutsTotal: number;
  /** Settled payments per merchantPlatform analytics. */
  settledPayments: number;
  /** Expected: settledPayments − modulePayoutsTotal. */
  expectedPayable: number;
  /** ledgerPayableBalance − expectedPayable — must be ~0. */
  discrepancy: number;
}

/**
 * Verify merchant:payable ledger balance matches (settled payments − payouts).
 *
 * Note: settled payments are tracked by the merchantPlatform analytics (not
 * the event stream), so this reconciliation crosses the event/UI boundary.
 * The ledger reflects only payouts (DRs); we expect the ledger balance to be
 * −payoutsTotal (a debit balance, since we never CR'd merchant:payable from
 * settled-payment events because they aren't on the event stream).
 */
export function reconcileMerchant(
  merchantId: string,
  ledger: LedgerEngine,
  merchantPlatform: MerchantPlatform,
  payoutService: PayoutService,
): MerchantReconciliation {
  const bal = ledger.getAccountBalance(`merchant:payable:${merchantId}`);
  const ledgerPayableBalance = round(bal.balance, 6); // expected: −payoutsTotal
  const ledgerPayoutsTotal = round(bal.debit, 6);

  const completed = payoutService.list({ merchantId, state: 'completed' });
  const modulePayoutsTotal = round(
    completed.reduce((s, p) => s + p.sourceAmount, 0),
    6,
  );

  const analytics = merchantPlatform.getAnalytics(merchantId);
  const settledPayments = round(analytics.totalRevenue, 6);

  // merchant:payable is credit-normal. CR increases (settled), DR decreases (payouts).
  // Expected balance = settledPayments − modulePayoutsTotal.
  const expectedPayable = round(settledPayments - modulePayoutsTotal, 6);
  const discrepancy = round(ledgerPayableBalance - expectedPayable, 6);

  return {
    merchantId,
    reconciled: Math.abs(discrepancy) < EPSILON,
    ledgerPayableBalance,
    ledgerPayoutsTotal,
    modulePayoutsTotal,
    settledPayments,
    expectedPayable,
    discrepancy,
  };
}

/* ========================================================================== */
/* LP                                                                          */
/* ========================================================================== */

export interface LPReconciliation {
  lpId: string;
  reconciled: boolean;
  /** LP's stake (Twin Token capacity) per settlementCapacityVault. */
  stake: number;
  /** LP's locked collateral per collateralVault. */
  collateral: number;
  /** Ledger balance of lp:collateral:lpId. */
  ledgerCollateral: number;
  /** LP's authorized exposure per lpLifecycle. */
  authorizedExposure: number;
  /** LP's current exposure per lpLifecycle. */
  currentExposure: number;
  /** authorizedExposure > 0 ? currentExposure / authorizedExposure : 0. */
  utilization: number;
  discrepancy: number;
}

/**
 * Verify LP collateral in the ledger matches the collateralVault.
 *
 * Note: lp:collateral:${lpId} ledger accounts are populated ONLY from
 * merchant.verified events in the standard projection (merchant bond →
 * lp:collateral:merchantId). LP-locked collateral (collateralVault.lock for
 * an LP) isn't currently projected to the ledger because the collateral.locked
 * event isn't in the standard event→journal mapping. This reconciliation
 * flags the discrepancy — production would extend the projection to handle
 * collateral.locked events.
 */
export function reconcileLP(
  lpId: string,
  ledger: LedgerEngine,
  lpLifecycle: LPLifecycle,
  collateralVault: CollateralVault,
): LPReconciliation {
  const lp = lpLifecycle.get(lpId);
  const stake = lp ? lp.stakeIds.length : 0; // # of stakes; for $ amount, query capacityVault
  const collateral = collateralVault.totalLockedByLp(lpId);
  const authorizedExposure = lp?.authorizedExposure ?? 0;
  const currentExposure = lp?.currentExposure ?? 0;
  const utilization = authorizedExposure > 0 ? round(currentExposure / authorizedExposure, 6) : 0;

  const bal = ledger.getAccountBalance(`lp:collateral:${lpId}`);
  const ledgerCollateral = round(bal.balance, 6); // debit-normal → positive
  const discrepancy = round(ledgerCollateral - collateral, 6);

  return {
    lpId,
    reconciled: Math.abs(discrepancy) < EPSILON,
    stake,
    collateral,
    ledgerCollateral,
    authorizedExposure,
    currentExposure,
    utilization,
    discrepancy,
  };
}

/* ========================================================================== */
/* Treasury                                                                    */
/* ========================================================================== */

export interface TreasuryReconciliation {
  reconciled: boolean;
  /** Ledger balance of equity:treasury (credit-normal → negate). */
  ledgerTreasury: number;
  /** Sum of merchant bonds from merchantPlatform.allMerchants(). */
  bondSum: number;
  /** Sum of fee revenue in the ledger (across all revenue:fees:* accounts). */
  feeRevenue: number;
  /** Expected: bondSum + feeRevenue. */
  expectedTreasury: number;
  /** ledgerTreasury − expectedTreasury — must be ~0. */
  discrepancy: number;
}

/**
 * Verify equity:treasury matches (sum of merchant bonds + fees collected).
 *
 * The merchant.verified event posts: DR lp:collateral:${mid} CR equity:treasury
 * for the bond amount. Fees are credited to revenue:fees:${method} (not
 * equity:treasury) by the payout.completed projection. The reconciliation
 * expects:
 *     equity:treasury balance === sum(bonds)
 *     AND equity:treasury + revenue:fees total === sum(bonds) + sum(fees)
 * The second invariant is what we check here — the fees haven't been "closed"
 * to equity yet, so the combined balance must equal bond + fee revenue.
 */
export function reconcileTreasury(
  ledger: LedgerEngine,
  merchantPlatform: MerchantPlatform,
): TreasuryReconciliation {
  const treas = ledger.getAccountBalance('equity:treasury');
  const ledgerTreasury = round(-treas.balance, 6); // credit-normal → negate

  const merchants = merchantPlatform.allMerchants();
  const bondSum = round(
    merchants.filter((m) => m.state === 'verified' || m.state === 'active').reduce((s, m) => s + m.bond, 0),
    6,
  );

  let feeRevenue = 0;
  for (const code of ledger.getAccountCodes()) {
    if (code.startsWith('revenue:fees:')) {
      const bal = ledger.getAccountBalance(code);
      feeRevenue = round(feeRevenue - bal.balance, 6);
    }
  }

  const expectedTreasury = round(bondSum + feeRevenue, 6);
  const discrepancy = round(ledgerTreasury - bondSum, 6); // direct: equity:treasury should = bondSum
  const combinedDiscrepancy = round(ledgerTreasury + feeRevenue - expectedTreasury, 6);

  return {
    reconciled: Math.abs(discrepancy) < EPSILON && Math.abs(combinedDiscrepancy) < EPSILON,
    ledgerTreasury,
    bondSum,
    feeRevenue,
    expectedTreasury,
    discrepancy,
  };
}

/* ========================================================================== */
/* Daily Reconciliation                                                        */
/* ========================================================================== */

export interface DailyReconciliationReport {
  asOfTs: number;
  /** Overall: true iff every sub-reconciliation reconciled. */
  reconciled: boolean;
  trialBalance: {
    balanced: boolean;
    totalDebits: number;
    totalCredits: number;
    discrepancy: number;
  };
  twinTokenBacking: TwinTokenBackingReconciliation;
  escrow: EscrowReconciliation;
  payouts: PayoutReconciliation;
  treasury: TreasuryReconciliation;
  merchants: MerchantReconciliation[];
  lps: LPReconciliation[];
  /** Count of sub-reconciliations that failed. */
  failedCount: number;
  /** Wall-clock duration of the reconciliation run, in ms. */
  durationMs: number;
}

/**
 * Run every reconciliation against the supplied ledger + module singletons.
 * Returns a DailyReconciliationReport. Never throws.
 */
export function dailyReconciliation(params: {
  asOfTs?: number;
  ledger: LedgerEngine;
  twinTokenEngine: TwinTokenEngine;
  escrowModule: SettlementEscrow;
  collateralVault: CollateralVault;
  payoutService: PayoutService;
  merchantPlatform: MerchantPlatform;
  lpLifecycle: LPLifecycle;
}): DailyReconciliationReport {
  const start = Date.now();
  const asOfTs = params.asOfTs ?? Date.now();
  const ledger = params.ledger;

  // Trial balance.
  const tb = ledger.getTrialBalance(asOfTs);
  const trialBalance = {
    balanced: tb.balanced,
    totalDebits: tb.totalDebits,
    totalCredits: tb.totalCredits,
    discrepancy: round(Math.abs(tb.totalDebits - tb.totalCredits), 6),
  };

  // Sub-reconciliations.
  const twinTokenBacking = reconcileTwinTokenBacking(ledger, params.twinTokenEngine);
  const escrow = reconcileEscrow(ledger, params.escrowModule, params.twinTokenEngine);
  const payouts = reconcilePayouts(ledger, params.payoutService);
  const treasury = reconcileTreasury(ledger, params.merchantPlatform);

  const merchants = params.merchantPlatform.allMerchants().map((m) =>
    reconcileMerchant(m.id, ledger, params.merchantPlatform, params.payoutService),
  );
  const lps = params.lpLifecycle.all().map((lp) =>
    reconcileLP(lp.id, ledger, params.lpLifecycle, params.collateralVault),
  );

  let failedCount = 0;
  if (!trialBalance.balanced) failedCount++;
  if (!twinTokenBacking.reconciled) failedCount++;
  if (!escrow.reconciled) failedCount++;
  if (!payouts.reconciled) failedCount++;
  if (!treasury.reconciled) failedCount++;
  for (const m of merchants) if (!m.reconciled) failedCount++;
  for (const l of lps) if (!l.reconciled) failedCount++;

  const reconciled = failedCount === 0;

  return {
    asOfTs,
    reconciled,
    trialBalance,
    twinTokenBacking,
    escrow,
    payouts,
    treasury,
    merchants,
    lps,
    failedCount,
    durationMs: Date.now() - start,
  };
}
