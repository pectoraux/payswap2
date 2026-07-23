/**
 * Settlement Engine — executes a routed plan atomically, frame by frame.
 *
 * Accounting model
 * ----------------
 * The kernel keeps an OBLIGATIONS ledger in the settlement (merchant) currency.
 * Every wallet, reserve and LP position is a LIABILITY (what PaySwap owes that
 * party); fees accrue to Treasury (EQUITY). The buyer's wallet is pre-funded
 * with the payment notional, so a payment is a chain of balanced transfers
 * between obligation accounts — no external cash account is needed and the
 * transaction's entries always sum to zero (Σdebit = Σcredit).
 *
 *   Frame 1  Debit Buyer        Dr Buyer            — buyer wallet pays out
 *   Frame 2  Credit Reserve     Cr Reserve(source)  — corridor holds the funds
 *   Frame 3  Mint Twin Token    (off-ledger)        — cross-border claim arises
 *   Frame 4  Burn Twin Token    Dr Reserve(source)  — source reserve releases
 *                                           Cr LP   — to LPs (owed the bridge)
 *   Frame 5  Credit Merchant    Dr Reserve(dest)    — destination reserve pays
 *                                           Cr Merchant  — merchant wallet
 *                                           Cr Treasury  — fees accrue
 *
 * Net result: buyer wallet ↓, source reserve net 0, LPs owed the draw,
 * destination reserve ↓ by (amount + fees), merchant wallet ↑, treasury ↑.
 */
import type {
  SimulationScenario,
  LedgerEntry,
  SimulationEvent,
  TwinTokenRecord,
  WorldState,
  CurrencyCode,
} from './types';
import type { RoutingResult } from './routing';
import { LedgerEngine } from './ledger';
import { ReserveEngine } from './reserve';
import { LiquidityEngine } from './liquidity';
import { TwinTokenEngine } from './twin-token';
import { eventEngine } from './event';
import { round } from './support';

export interface SettlementOutput {
  ledger: LedgerEntry[];
  events: SimulationEvent[];
  twinTokens: TwinTokenRecord[];
  txId: string;
  fees: number;
  lpFees: number;
  fxSpread: number;
  reserveFee: number;
}

const FRAME = {
  DEBIT_BUYER: 1,
  CREDIT_RESERVE: 2,
  MINT_TWIN: 3,
  BURN_TWIN: 4,
  CREDIT_MERCHANT: 5,
} as const;

const RESERVE_FEE_BPS = 4;

export class SettlementEngine {
  private ledger: LedgerEngine;
  private reserve: ReserveEngine;
  private liquidity: LiquidityEngine;
  private twin: TwinTokenEngine;

  constructor(world: WorldState) {
    this.ledger = new LedgerEngine(world);
    this.reserve = new ReserveEngine(world);
    this.liquidity = new LiquidityEngine(world);
    this.twin = new TwinTokenEngine();
  }

  exec(txId: string, scenario: SimulationScenario, routing: RoutingResult): SettlementOutput {
    const cur = scenario.merchant.currency; // settlement currency for the obligation ledger
    const amount = scenario.amount;

    // --- Accounts (obligation ledger; all LIABILITY except Treasury EQUITY) -
    const buyerAcc = `buyer:${scenario.buyer.country}`;
    const srcReserveAcc = `reserve:${scenario.buyer.country}`;
    const dstReserveAcc = `reserve:${scenario.merchant.country}`;
    const merchantAcc = `merchant:${scenario.merchant.country}`;
    const lpAcc = (id: string) => `lp:${id}`;
    const treasuryAcc = `treasury:fees`;

    // Opening balances: buyer wallet pre-funded; reserves from scenario; rest 0.
    this.ledger.ensureAccount(buyerAcc, `${scenario.buyer.label} wallet`, cur, 'liability', amount);
    const srcReserve = scenario.reserves.find((r) => r.country === scenario.buyer.country);
    this.ledger.ensureAccount(
      srcReserveAcc,
      `Reserve ${scenario.buyer.country}`,
      cur,
      'liability',
      srcReserve?.balance ?? 0,
    );
    const dstReserve = scenario.reserves.find((r) => r.country === scenario.merchant.country);
    this.ledger.ensureAccount(
      dstReserveAcc,
      `Reserve ${scenario.merchant.country}`,
      cur,
      'liability',
      dstReserve?.balance ?? 0,
    );
    this.ledger.ensureAccount(merchantAcc, `${scenario.merchant.label} wallet`, cur, 'liability', 0);
    this.ledger.ensureAccount(treasuryAcc, 'Treasury (fees)', cur, 'equity', 0);
    for (const u of routing.lpUsage) {
      this.ledger.ensureAccount(lpAcc(u.lpId), `LP ${u.lpId}`, cur, 'liability', 0);
    }

    // --- Frame 1: Debit Buyer (wallet pays out) --------------------------
    this.ledger.post({
      txId,
      accountId: buyerAcc,
      debit: amount,
      memo: `Debit ${scenario.buyer.label} wallet (≈ ${round(routing.sourceAmount, 2)} ${scenario.buyer.currency} via ${scenario.buyer.method})`,
      frame: FRAME.DEBIT_BUYER,
    });

    // --- Frame 2: Credit Source Reserve (corridor holds the funds) -------
    this.ledger.post({
      txId,
      accountId: srcReserveAcc,
      credit: amount,
      memo: `Credit source reserve ${scenario.buyer.country}`,
      frame: FRAME.CREDIT_RESERVE,
    });
    this.reserve.mutate({
      country: scenario.buyer.country,
      currency: cur,
      delta: amount,
      reason: 'Buyer deposit',
      frame: FRAME.CREDIT_RESERVE,
    });

    // --- Frame 3: Mint Twin Token (off-ledger cross-border claim) --------
    const twin = this.twin.mint(
      amount,
      cur,
      scenario.buyer.country,
      scenario.merchant.country,
      FRAME.MINT_TWIN,
    );
    this.twin.transfer(twin, FRAME.MINT_TWIN);

    // --- Frame 4: Burn Twin Token — source reserve releases to LPs -------
    // The source reserve (holding the buyer's notional) transfers to the LPs
    // that bridged the cross-currency leg. LPs are now owed the draw.
    for (const u of routing.lpUsage) {
      const draw = this.liquidity.draw({ lpId: u.lpId, amount: u.drawn, frame: FRAME.BURN_TWIN });
      this.ledger.post({
        txId,
        accountId: srcReserveAcc,
        debit: draw.drawn,
        memo: `Source reserve releases to LP ${u.lpId} (bridge)`,
        frame: FRAME.BURN_TWIN,
      });
      this.ledger.post({
        txId,
        accountId: lpAcc(u.lpId),
        credit: draw.drawn,
        memo: `LP ${u.lpId} bridge liquidity provided`,
        frame: FRAME.BURN_TWIN,
      });
      this.reserve.mutate({
        country: scenario.buyer.country,
        currency: cur,
        delta: -draw.drawn,
        reason: `Release to LP ${u.lpId}`,
        frame: FRAME.BURN_TWIN,
      });
    }
    this.twin.burn(twin, FRAME.BURN_TWIN);

    // --- Frame 5: Credit Merchant — destination reserve pays out ---------
    const lpFees = round(routing.lpUsage.reduce((s, u) => s + u.fee, 0), 6);
    const fxSpread = round(routing.fxQuote.spreadCost, 6);
    const reserveFee = round((amount * RESERVE_FEE_BPS) / 1e4, 6);
    const fees = round(lpFees + fxSpread + reserveFee, 6);

    // Destination reserve pays merchant `amount` ...
    this.ledger.post({
      txId,
      accountId: dstReserveAcc,
      debit: amount,
      memo: `Destination reserve pays merchant`,
      frame: FRAME.CREDIT_MERCHANT,
    });
    this.ledger.post({
      txId,
      accountId: merchantAcc,
      credit: amount,
      memo: `Credit ${scenario.merchant.label} wallet`,
      frame: FRAME.CREDIT_MERCHANT,
    });
    // ... and accrues fees to treasury.
    this.ledger.post({
      txId,
      accountId: dstReserveAcc,
      debit: fees,
      memo: `Destination reserve remits fees`,
      frame: FRAME.CREDIT_MERCHANT,
    });
    this.ledger.post({
      txId,
      accountId: treasuryAcc,
      credit: fees,
      memo: `Fees accrued to treasury (LP ${round(lpFees, 2)} + FX ${round(fxSpread, 2)} + reserve ${round(reserveFee, 2)})`,
      frame: FRAME.CREDIT_MERCHANT,
    });
    this.reserve.mutate({
      country: scenario.merchant.country,
      currency: cur,
      delta: -(amount + fees),
      reason: 'Merchant payout + fees',
      frame: FRAME.CREDIT_MERCHANT,
    });

    return {
      ledger: this.ledger.all(),
      events: eventEngine.read(),
      twinTokens: this.twin.all(),
      txId,
      fees,
      lpFees,
      fxSpread,
      reserveFee,
    };
  }

  getEngines() {
    return { ledger: this.ledger, reserve: this.reserve, liquidity: this.liquidity, twin: this.twin };
  }
}

export { FRAME };
