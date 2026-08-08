/**
 * M-RT-30: Liquidity Policy Engine — the brain that selects settlement
 * strategies and produces deterministic execution plans.
 *
 * The LiquidityPolicyEngine takes a payment intent and the current reserve
 * state, then produces a LiquidityExecutionPlan containing:
 *   - strategy (one of 5: LOCAL_RAIL, RESERVE_TO_RESERVE, RESERVE_TO_MARKET,
 *     MARKET_TO_RESERVE, MARKET_TO_MARKET)
 *   - treasuryActions (reserve credits, twin token mint/burn)
 *   - liquidityActions (stablecoin purchase, LP bandwidth allocation)
 *   - settlementActions (escrow lock, LP claim, recipient confirm, release)
 *   - fallbackGraph (deterministic fallback branches)
 *   - rollbackPlan (how to reverse if something fails)
 *
 * Strategy selection is deterministic:
 *   1. Same country → LOCAL_RAIL
 *   2. Both countries have fiat reserves → RESERVE_TO_RESERVE
 *   3. Sender has reserve, receiver doesn't → RESERVE_TO_MARKET
 *   4. Sender doesn't, receiver has reserve → MARKET_TO_RESERVE
 *   5. Neither has reserve → MARKET_TO_MARKET
 *
 * All output is deterministic — same input + same reserve state = same plan.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export type SettlementStrategy =
  | 'LOCAL_RAIL'
  | 'RESERVE_TO_RESERVE'
  | 'RESERVE_TO_MARKET'
  | 'MARKET_TO_RESERVE'
  | 'MARKET_TO_MARKET';

export type BandwidthAssetType = 'fiat' | 'stablecoin' | 'twin_token';

export interface BandwidthPosition {
  lpId: string;
  country: string;
  assetType: BandwidthAssetType;
  currency: string;
  capacity: number;
  reserved: number;
  used: number;
  available: number;  // capacity - reserved - used
  escrow: number;
  bond: number;
  status: 'active' | 'suspended' | 'slashed';
  participationMode: 'automatic' | 'manual';
  /** For fiat bandwidth: debit authorization details */
  debitAuthorization?: {
    connector: 'stripe' | 'ach' | 'bank' | 'mobile_money';
    authorized: boolean;
    accountId?: string;
  };
}

export interface TreasuryAction {
  type: 'credit_fiat_reserve' | 'debit_fiat_reserve' | 'mint_twin_tokens' | 'burn_twin_tokens' | 'credit_stablecoin_reserve' | 'debit_stablecoin_reserve';
  country?: string;
  currency: string;
  amount: number;
  accountId?: string;
  reason: string;
}

export interface LiquidityAction {
  type: 'purchase_stablecoin' | 'sell_stablecoin' | 'lock_stablecoin' | 'release_stablecoin' | 'allocate_lp_bandwidth' | 'release_lp_bandwidth';
  country: string;
  currency: string;
  amount: number;
  lpId?: string;
  assetType?: BandwidthAssetType;
  reason: string;
}

export interface SettlementAction {
  type: 'create_contract' | 'fund_contract' | 'lp_claim' | 'lp_pay_recipient' | 'recipient_confirm' | 'release_escrow' | 'close_contract' | 'timeout_dispute';
  contractId?: string;
  lpId?: string;
  recipientId?: string;
  amount: number;
  currency: string;
  reason: string;
}

export interface FallbackBranch {
  condition: string;
  strategy: SettlementStrategy | 'CANCEL_REFUND';
  actions: string[];
}

export interface FallbackGraph {
  primary: SettlementStrategy;
  fallbacks: FallbackBranch[];
}

export interface RollbackStep {
  step: string;
  action: string;
  condition: string;
}

export interface RollbackPlan {
  steps: RollbackStep[];
}

export interface FeeModel {
  lpSharePercent: number;
  payswapSharePercent: number;
  totalFeeBps: number;
}

export interface LiquidityExecutionPlan {
  planId: string;
  intentId: string;
  strategy: SettlementStrategy;
  fromCountry: string;
  toCountry: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  fxRate: number;
  treasuryActions: TreasuryAction[];
  liquidityActions: LiquidityAction[];
  settlementActions: SettlementAction[];
  requiredBandwidth: {
    assetType: BandwidthAssetType;
    country: string;
    currency: string;
    amount: number;
  }[];
  requiredEscrow: {
    assetType: BandwidthAssetType;
    currency: string;
    amount: number;
  }[];
  reserveAware: boolean;
  stablecoinUsage: {
    required: boolean;
    amount: number;
    currency: string;
    source: 'treasury' | 'marketplace' | 'lp_bandwidth';
  };
  feeModel: FeeModel;
  fallbackGraph: FallbackGraph;
  rollbackPlan: RollbackPlan;
  compiledAt: number;
}

// ─── Reserve State (input to the policy engine) ────────────────────────────

export interface ReserveState {
  country: string;
  currency: string;
  hasFiatReserve: boolean;
  fiatReserveAmount: number;
  hasStablecoinReserve: boolean;
  stablecoinReserveAmount: number;
  maturity: 'stablecoin_only' | 'hybrid' | 'mostly_fiat' | 'fully_fiat' | 'reserve_exporter';
}

export interface PolicyEngineInput {
  fromCountry: string;
  toCountry: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  fxRate: number;
  senderReserve: ReserveState;
  receiverReserve: ReserveState;
  /** Available LP bandwidth in the sender's country */
  senderBandwidth: BandwidthPosition[];
  /** Available LP bandwidth in the receiver's country */
  receiverBandwidth: BandwidthPosition[];
  /** Treasury stablecoin inventory */
  treasuryStablecoins: { currency: string; amount: number }[];
}

// Re-export the single tier-selection rule so callers can import it from
// either this module or directly from `./settlement-waterfall`. The
// invariant test (tests/single-rule-invariant.test.ts) asserts that this
// module imports `resolvePayment` from `./settlement-waterfall` and uses
// it inside `selectStrategy` — not a hand-written tier matrix.
export {
  resolvePayment,
  strategyToTier,
  MANUAL_SETTLEMENT_STRATEGY,
  type ResolvePaymentInput,
  type ResolvePaymentResult,
  type SettlementTier,
} from './settlement-waterfall';
import { resolvePayment } from './settlement-waterfall';

// ─── Liquidity Policy Engine ───────────────────────────────────────────────

export class LiquidityPolicyEngine {
  /**
   * Compile a payment intent into a LiquidityExecutionPlan.
   *
   * This is the core of the settlement kernel. It:
   *   1. Selects the settlement strategy based on reserve availability
   *   2. Produces treasury actions (reserve credits, twin token mint/burn)
   *   3. Produces liquidity actions (stablecoin purchase, LP bandwidth)
   *   4. Produces settlement actions (escrow, LP claim, confirmation)
   *   5. Builds a deterministic fallback graph
   *   6. Builds a rollback plan
   *
   * The output is deterministic: same input = same plan.
   */
  compile(input: PolicyEngineInput): LiquidityExecutionPlan {
    const strategy = this.selectStrategy(input);
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const treasuryActions: TreasuryAction[] = [];
    const liquidityActions: LiquidityAction[] = [];
    const settlementActions: SettlementAction[] = [];
    const requiredBandwidth: LiquidityExecutionPlan['requiredBandwidth'] = [];
    const requiredEscrow: LiquidityExecutionPlan['requiredEscrow'] = [];

    let stablecoinUsage: LiquidityExecutionPlan['stablecoinUsage'] = {
      required: false, amount: 0, currency: 'USDC', source: 'treasury',
    };

    let feeModel: FeeModel = {
      lpSharePercent: 0,
      payswapSharePercent: 100,
      totalFeeBps: 80,
    };

    // ── Strategy-specific plan compilation ──────────────────────────────

    switch (strategy) {
      case 'LOCAL_RAIL':
        this.compileLocalRail(input, treasuryActions, settlementActions);
        break;

      case 'RESERVE_TO_RESERVE':
        this.compileReserveToReserve(input, treasuryActions, settlementActions);
        break;

      case 'RESERVE_TO_MARKET':
        stablecoinUsage = this.compileReserveToMarket(
          input, treasuryActions, liquidityActions, settlementActions,
          requiredBandwidth, requiredEscrow,
        );
        feeModel = { lpSharePercent: 80, payswapSharePercent: 20, totalFeeBps: 120 };
        break;

      case 'MARKET_TO_RESERVE':
        stablecoinUsage = this.compileMarketToReserve(
          input, treasuryActions, liquidityActions, settlementActions,
          requiredBandwidth,
        );
        feeModel = { lpSharePercent: 60, payswapSharePercent: 40, totalFeeBps: 100 };
        break;

      case 'MARKET_TO_MARKET':
        stablecoinUsage = this.compileMarketToMarket(
          input, treasuryActions, liquidityActions, settlementActions,
          requiredBandwidth, requiredEscrow,
        );
        feeModel = { lpSharePercent: 90, payswapSharePercent: 10, totalFeeBps: 150 };
        break;
    }

    // ── Fallback graph (deterministic) ──────────────────────────────────

    const fallbackGraph = this.buildFallbackGraph(strategy, input);

    // ── Rollback plan ───────────────────────────────────────────────────

    const rollbackPlan = this.buildRollbackPlan(strategy, treasuryActions, liquidityActions);

    return {
      planId,
      intentId: `intent_${planId}`,
      strategy,
      fromCountry: input.fromCountry,
      toCountry: input.toCountry,
      fromCurrency: input.fromCurrency,
      toCurrency: input.toCurrency,
      amount: input.amount,
      fxRate: input.fxRate,
      treasuryActions,
      liquidityActions,
      settlementActions,
      requiredBandwidth,
      requiredEscrow,
      reserveAware: true,
      stablecoinUsage,
      feeModel,
      fallbackGraph,
      rollbackPlan,
      compiledAt: Date.now(),
    };
  }

  // ─── Strategy Selection ───────────────────────────────────────────────────

  /**
   * Select the settlement strategy based on reserve availability.
   * Deterministic: same input = same strategy.
   *
   * SINGLE-RULE INVARIANT: this method delegates to `resolvePayment` from
   * `./settlement-waterfall`. That module is the ONE place in the codebase
   * that decides which settlement tier a payment routes through — the
   * PaymentCommandHandler in `runtime/dispatcher/handlers.ts` calls the
   * same function. There is no parallel tier-selection implementation.
   * (See `tests/single-rule-invariant.test.ts`.)
   */
  selectStrategy(input: PolicyEngineInput): SettlementStrategy {
    const result = resolvePayment(input);
    // Map the waterfall result back to the canonical strategy enum.
    // Tier 5 (manual settlement) has no equivalent in the legacy enum —
    // fall back to MARKET_TO_MARKET so the existing fallback graph still
    // compiles a plan (the plan's rollback + fallback handle the rest).
    if (result.tier === 5) return 'MARKET_TO_MARKET';
    return result.strategy as SettlementStrategy;
  }

  // ─── Strategy 1: LOCAL_RAIL ───────────────────────────────────────────────

  /**
   * Same country. Credit reserve, mint twin tokens, credit recipient.
   * No stablecoins, no LPs.
   */
  private compileLocalRail(
    input: PolicyEngineInput,
    treasuryActions: TreasuryAction[],
    settlementActions: SettlementAction[],
  ): void {
    // 1. Credit PaySwap fiat reserve with sender's funds
    treasuryActions.push({
      type: 'credit_fiat_reserve',
      country: input.fromCountry,
      currency: input.fromCurrency,
      amount: input.amount,
      reason: `LOCAL_RAIL: Credit reserve with sender's ${input.amount} ${input.fromCurrency}`,
    });

    // 2. Mint twin tokens (1:1 with reserve credit)
    treasuryActions.push({
      type: 'mint_twin_tokens',
      country: input.fromCountry,
      currency: input.fromCurrency,
      amount: input.amount,
      reason: `LOCAL_RAIL: Mint ${input.amount} twin tokens for recipient`,
    });

    // 3. Settlement: immediate, no escrow, no LP
    settlementActions.push({
      type: 'create_contract',
      amount: input.amount,
      currency: input.fromCurrency,
      reason: 'LOCAL_RAIL: Immediate settlement (same country, reserve-backed)',
    });

    settlementActions.push({
      type: 'close_contract',
      amount: input.amount,
      currency: input.fromCurrency,
      reason: 'LOCAL_RAIL: Settlement complete',
    });
  }

  // ─── Strategy 2: RESERVE_TO_RESERVE ───────────────────────────────────────

  /**
   * Both countries have fiat reserves. Credit reserve A, mint twin tokens B.
   * No stablecoins, no LPs (unless reserve B is insufficient at redemption).
   */
  private compileReserveToReserve(
    input: PolicyEngineInput,
    treasuryActions: TreasuryAction[],
    settlementActions: SettlementAction[],
  ): void {
    const recipientAmount = input.amount * input.fxRate;

    // 1. Credit sender's country reserve
    treasuryActions.push({
      type: 'credit_fiat_reserve',
      country: input.fromCountry,
      currency: input.fromCurrency,
      amount: input.amount,
      reason: `RESERVE_TO_RESERVE: Credit ${input.fromCountry} reserve`,
    });

    // 2. Mint recipient's country twin tokens
    treasuryActions.push({
      type: 'mint_twin_tokens',
      country: input.toCountry,
      currency: input.toCurrency,
      amount: recipientAmount,
      reason: `RESERVE_TO_RESERVE: Mint ${recipientAmount} ${input.toCurrency} twin tokens`,
    });

    // 3. Settlement: recipient gets twin tokens, can redeem later
    settlementActions.push({
      type: 'create_contract',
      amount: recipientAmount,
      currency: input.toCurrency,
      reason: 'RESERVE_TO_RESERVE: Recipient receives twin tokens (redeemable later)',
    });

    settlementActions.push({
      type: 'close_contract',
      amount: recipientAmount,
      currency: input.toCurrency,
      reason: 'RESERVE_TO_RESERVE: Twin tokens credited, settlement complete',
    });
  }

  // ─── Strategy 3: RESERVE_TO_MARKET ────────────────────────────────────────

  /**
   * Sender has reserve, receiver doesn't. Stablecoins bridge the gap.
   *
   * Flow (with amendments):
   *   1. Credit sender's reserve
   *   2. Obtain stablecoins (treasury inventory or marketplace purchase)
   *   3. Lock stablecoins in escrow
   *   4. If LP fiat bandwidth in receiver country → attempt automatic fiat settlement
   *   5. If successful → unlock stablecoins, send to LP
   *   6. If failed/insufficient → create marketplace order in receiver country
   *   7. LP claims → LP pays recipient → recipient confirms → release stablecoins
   *
   * LPs can provide BOTH fiat bandwidth AND stablecoin bandwidth.
   * Fiat bandwidth: LP grants PaySwap approval to debit their bank/MoMo/PSP.
   */
  private compileReserveToMarket(
    input: PolicyEngineInput,
    treasuryActions: TreasuryAction[],
    liquidityActions: LiquidityAction[],
    settlementActions: SettlementAction[],
    requiredBandwidth: LiquidityExecutionPlan['requiredBandwidth'],
    requiredEscrow: LiquidityExecutionPlan['requiredEscrow'],
  ): LiquidityExecutionPlan['stablecoinUsage'] {
    const recipientAmount = input.amount * input.fxRate;

    // 1. Credit sender's reserve
    treasuryActions.push({
      type: 'credit_fiat_reserve',
      country: input.fromCountry,
      currency: input.fromCurrency,
      amount: input.amount,
      reason: `RESERVE_TO_MARKET: Credit ${input.fromCountry} reserve`,
    });

    // 2. Check stablecoin inventory
    const treasuryUSDC = input.treasuryStablecoins.find(s => s.currency === 'USDC');
    const treasuryHasStablecoins = treasuryUSDC && treasuryUSDC.amount >= recipientAmount;

    let stablecoinSource: 'treasury' | 'marketplace' | 'lp_bandwidth' = 'treasury';

    if (!treasuryHasStablecoins) {
      // 2a. Check LP stablecoin bandwidth first
      const lpStablecoinBW = input.receiverBandwidth.find(
        bw => bw.assetType === 'stablecoin' && bw.available >= recipientAmount && bw.status === 'active',
      );

      if (lpStablecoinBW) {
        stablecoinSource = 'lp_bandwidth';
        liquidityActions.push({
          type: 'allocate_lp_bandwidth',
          country: input.toCountry,
          currency: 'USDC',
          amount: recipientAmount,
          lpId: lpStablecoinBW.lpId,
          assetType: 'stablecoin',
          reason: `RESERVE_TO_MARKET: Allocate LP stablecoin bandwidth`,
        });
      } else {
        // 2b. Purchase stablecoins on marketplace
        stablecoinSource = 'marketplace';
        liquidityActions.push({
          type: 'purchase_stablecoin',
          country: input.fromCountry,
          currency: 'USDC',
          amount: recipientAmount,
          reason: `RESERVE_TO_MARKET: Purchase stablecoins (treasury insufficient)`,
        });
      }
    }

    // 3. Lock stablecoins in escrow
    liquidityActions.push({
      type: 'lock_stablecoin',
      country: input.toCountry,
      currency: 'USDC',
      amount: recipientAmount,
      reason: `RESERVE_TO_MARKET: Lock stablecoins in escrow`,
    });

    requiredEscrow.push({
      assetType: 'stablecoin',
      currency: 'USDC',
      amount: recipientAmount,
    });

    // 4. Check LP FIAT bandwidth in receiver country (amendment)
    const lpFiatBW = input.receiverBandwidth.find(
      bw => bw.assetType === 'fiat' &&
            bw.currency === input.toCurrency &&
            bw.available >= recipientAmount &&
            bw.status === 'active' &&
            bw.debitAuthorization?.authorized,
    );

    if (lpFiatBW) {
      // 4a. Automatic fiat settlement via LP fiat bandwidth
      liquidityActions.push({
        type: 'allocate_lp_bandwidth',
        country: input.toCountry,
        currency: input.toCurrency,
        amount: recipientAmount,
        lpId: lpFiatBW.lpId,
        assetType: 'fiat',
        reason: `RESERVE_TO_MARKET: Allocate LP fiat bandwidth for auto-settlement`,
      });

      requiredBandwidth.push({
        assetType: 'fiat',
        country: input.toCountry,
        currency: input.toCurrency,
        amount: recipientAmount,
      });

      // 5. LP pays recipient via local rail (auto)
      settlementActions.push({
        type: 'create_contract',
        lpId: lpFiatBW.lpId,
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'RESERVE_TO_MARKET: Auto-settlement via LP fiat bandwidth',
      });

      // 6. Recipient confirms
      settlementActions.push({
        type: 'recipient_confirm',
        lpId: lpFiatBW.lpId,
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'RESERVE_TO_MARKET: Recipient confirms receipt',
      });

      // 7. Release stablecoins to LP
      liquidityActions.push({
        type: 'release_stablecoin',
        country: input.toCountry,
        currency: 'USDC',
        amount: recipientAmount,
        lpId: lpFiatBW.lpId,
        reason: `RESERVE_TO_MARKET: Release stablecoins to LP (auto-settlement succeeded)`,
      });

      settlementActions.push({
        type: 'release_escrow',
        lpId: lpFiatBW.lpId,
        amount: recipientAmount,
        currency: 'USDC',
        reason: 'RESERVE_TO_MARKET: Escrow released after auto-settlement',
      });

      settlementActions.push({
        type: 'close_contract',
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'RESERVE_TO_MARKET: Settlement complete (auto)',
      });
    } else {
      // 4b. No fiat bandwidth → create marketplace order
      settlementActions.push({
        type: 'create_contract',
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'RESERVE_TO_MARKET: Create marketplace settlement order (no fiat bandwidth)',
      });

      requiredBandwidth.push({
        assetType: 'stablecoin',
        country: input.toCountry,
        currency: 'USDC',
        amount: recipientAmount,
      });

      // 8. LP claims
      settlementActions.push({
        type: 'lp_claim',
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'RESERVE_TO_MARKET: LP claims settlement order',
      });

      // 9. LP pays recipient
      settlementActions.push({
        type: 'lp_pay_recipient',
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'RESERVE_TO_MARKET: LP pays recipient via local rail',
      });

      // 10. Recipient confirms
      settlementActions.push({
        type: 'recipient_confirm',
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'RESERVE_TO_MARKET: Recipient confirms receipt',
      });

      // 11. Release stablecoins to LP
      liquidityActions.push({
        type: 'release_stablecoin',
        country: input.toCountry,
        currency: 'USDC',
        amount: recipientAmount,
        reason: `RESERVE_TO_MARKET: Release stablecoins to LP after confirmation`,
      });

      settlementActions.push({
        type: 'release_escrow',
        amount: recipientAmount,
        currency: 'USDC',
        reason: 'RESERVE_TO_MARKET: Escrow released after confirmation',
      });

      settlementActions.push({
        type: 'close_contract',
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'RESERVE_TO_MARKET: Settlement complete (marketplace)',
      });
    }

    return {
      required: true,
      amount: recipientAmount,
      currency: 'USDC',
      source: stablecoinSource,
    };
  }

  // ─── Strategy 4: MARKET_TO_RESERVE ────────────────────────────────────────

  /**
   * Sender doesn't have reserve, receiver does. LP/market provides stablecoins
   * on the sending side; twin tokens minted on the receiving side.
   */
  private compileMarketToReserve(
    input: PolicyEngineInput,
    treasuryActions: TreasuryAction[],
    liquidityActions: LiquidityAction[],
    settlementActions: SettlementAction[],
    requiredBandwidth: LiquidityExecutionPlan['requiredBandwidth'],
  ): LiquidityExecutionPlan['stablecoinUsage'] {
    const recipientAmount = input.amount * input.fxRate;

    // 1. Check LP stablecoin bandwidth in sender's country
    const lpStablecoinBW = input.senderBandwidth.find(
      bw => bw.assetType === 'stablecoin' && bw.available >= input.amount && bw.status === 'active',
    );

    let stablecoinSource: 'treasury' | 'marketplace' | 'lp_bandwidth' = 'lp_bandwidth';

    if (lpStablecoinBW) {
      // 1a. LP provides stablecoins directly
      liquidityActions.push({
        type: 'allocate_lp_bandwidth',
        country: input.fromCountry,
        currency: 'USDC',
        amount: input.amount,
        lpId: lpStablecoinBW.lpId,
        assetType: 'stablecoin',
        reason: `MARKET_TO_RESERVE: LP provides stablecoin bandwidth`,
      });

      requiredBandwidth.push({
        assetType: 'stablecoin',
        country: input.fromCountry,
        currency: 'USDC',
        amount: input.amount,
      });
    } else {
      // 1b. Purchase stablecoins on marketplace
      stablecoinSource = 'marketplace';
      liquidityActions.push({
        type: 'purchase_stablecoin',
        country: input.fromCountry,
        currency: 'USDC',
        amount: input.amount,
        reason: `MARKET_TO_RESERVE: Purchase stablecoins (no LP bandwidth)`,
      });
    }

    // 2. Credit stablecoins to treasury reserve
    treasuryActions.push({
      type: 'credit_stablecoin_reserve',
      country: input.fromCountry,
      currency: 'USDC',
      amount: input.amount,
      reason: `MARKET_TO_RESERVE: Credit treasury stablecoin reserve`,
    });

    // 3. Mint recipient's country twin tokens
    treasuryActions.push({
      type: 'mint_twin_tokens',
      country: input.toCountry,
      currency: input.toCurrency,
      amount: recipientAmount,
      reason: `MARKET_TO_RESERVE: Mint ${recipientAmount} ${input.toCurrency} twin tokens`,
    });

    // 4. Settlement: recipient gets twin tokens
    settlementActions.push({
      type: 'create_contract',
      amount: recipientAmount,
      currency: input.toCurrency,
      reason: 'MARKET_TO_RESERVE: Recipient receives twin tokens',
    });

    settlementActions.push({
      type: 'close_contract',
      amount: recipientAmount,
      currency: input.toCurrency,
      reason: 'MARKET_TO_RESERVE: Twin tokens credited',
    });

    return {
      required: true,
      amount: input.amount,
      currency: 'USDC',
      source: stablecoinSource,
    };
  }

  // ─── Strategy 5: MARKET_TO_MARKET ─────────────────────────────────────────

  /**
   * Neither country has reserves. Stablecoins bridge both sides.
   *
   * Flow (with amendments):
   *   1. Obtain stablecoins (LP bandwidth or marketplace) in sender country
   *   2. Lock stablecoins in escrow
   *   3. If LP fiat bandwidth in receiver country → attempt automatic fiat settlement
   *   4. If successful → unlock stablecoins, send to LP
   *   5. If failed/insufficient → create marketplace order in receiver country
   *   6. LP claims → LP pays recipient → recipient confirms → release stablecoins
   */
  private compileMarketToMarket(
    input: PolicyEngineInput,
    treasuryActions: TreasuryAction[],
    liquidityActions: LiquidityAction[],
    settlementActions: SettlementAction[],
    requiredBandwidth: LiquidityExecutionPlan['requiredBandwidth'],
    requiredEscrow: LiquidityExecutionPlan['requiredEscrow'],
  ): LiquidityExecutionPlan['stablecoinUsage'] {
    const recipientAmount = input.amount * input.fxRate;

    // 1. Obtain stablecoins in sender's country
    const lpStablecoinBW = input.senderBandwidth.find(
      bw => bw.assetType === 'stablecoin' && bw.available >= input.amount && bw.status === 'active',
    );

    let stablecoinSource: 'treasury' | 'marketplace' | 'lp_bandwidth' = 'lp_bandwidth';

    if (lpStablecoinBW) {
      liquidityActions.push({
        type: 'allocate_lp_bandwidth',
        country: input.fromCountry,
        currency: 'USDC',
        amount: input.amount,
        lpId: lpStablecoinBW.lpId,
        assetType: 'stablecoin',
        reason: `MARKET_TO_MARKET: LP provides stablecoin bandwidth`,
      });

      requiredBandwidth.push({
        assetType: 'stablecoin',
        country: input.fromCountry,
        currency: 'USDC',
        amount: input.amount,
      });
    } else {
      stablecoinSource = 'marketplace';
      liquidityActions.push({
        type: 'purchase_stablecoin',
        country: input.fromCountry,
        currency: 'USDC',
        amount: input.amount,
        reason: `MARKET_TO_MARKET: Purchase stablecoins (no LP bandwidth)`,
      });
    }

    // 2. Credit treasury stablecoin reserve
    treasuryActions.push({
      type: 'credit_stablecoin_reserve',
      country: input.fromCountry,
      currency: 'USDC',
      amount: input.amount,
      reason: `MARKET_TO_MARKET: Credit treasury stablecoin reserve`,
    });

    // 3. Lock stablecoins in escrow
    liquidityActions.push({
      type: 'lock_stablecoin',
      country: input.toCountry,
      currency: 'USDC',
      amount: recipientAmount,
      reason: `MARKET_TO_MARKET: Lock stablecoins in escrow`,
    });

    requiredEscrow.push({
      assetType: 'stablecoin',
      currency: 'USDC',
      amount: recipientAmount,
    });

    // 4. Check LP FIAT bandwidth in receiver country (amendment)
    const lpFiatBW = input.receiverBandwidth.find(
      bw => bw.assetType === 'fiat' &&
            bw.currency === input.toCurrency &&
            bw.available >= recipientAmount &&
            bw.status === 'active' &&
            bw.debitAuthorization?.authorized,
    );

    if (lpFiatBW) {
      // 4a. Automatic fiat settlement
      liquidityActions.push({
        type: 'allocate_lp_bandwidth',
        country: input.toCountry,
        currency: input.toCurrency,
        amount: recipientAmount,
        lpId: lpFiatBW.lpId,
        assetType: 'fiat',
        reason: `MARKET_TO_MARKET: Allocate LP fiat bandwidth for auto-settlement`,
      });

      requiredBandwidth.push({
        assetType: 'fiat',
        country: input.toCountry,
        currency: input.toCurrency,
        amount: recipientAmount,
      });

      settlementActions.push({
        type: 'create_contract',
        lpId: lpFiatBW.lpId,
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'MARKET_TO_MARKET: Auto-settlement via LP fiat bandwidth',
      });

      settlementActions.push({
        type: 'recipient_confirm',
        lpId: lpFiatBW.lpId,
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'MARKET_TO_MARKET: Recipient confirms receipt',
      });

      liquidityActions.push({
        type: 'release_stablecoin',
        country: input.toCountry,
        currency: 'USDC',
        amount: recipientAmount,
        lpId: lpFiatBW.lpId,
        reason: `MARKET_TO_MARKET: Release stablecoins to LP (auto-settlement)`,
      });

      settlementActions.push({
        type: 'release_escrow',
        lpId: lpFiatBW.lpId,
        amount: recipientAmount,
        currency: 'USDC',
        reason: 'MARKET_TO_MARKET: Escrow released (auto)',
      });

      settlementActions.push({
        type: 'close_contract',
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'MARKET_TO_MARKET: Settlement complete (auto)',
      });
    } else {
      // 4b. Marketplace fallback
      settlementActions.push({
        type: 'create_contract',
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'MARKET_TO_MARKET: Create marketplace settlement order',
      });

      requiredBandwidth.push({
        assetType: 'stablecoin',
        country: input.toCountry,
        currency: 'USDC',
        amount: recipientAmount,
      });

      settlementActions.push({
        type: 'lp_claim',
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'MARKET_TO_MARKET: LP claims settlement order',
      });

      settlementActions.push({
        type: 'lp_pay_recipient',
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'MARKET_TO_MARKET: LP pays recipient via local rail',
      });

      settlementActions.push({
        type: 'recipient_confirm',
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'MARKET_TO_MARKET: Recipient confirms receipt',
      });

      liquidityActions.push({
        type: 'release_stablecoin',
        country: input.toCountry,
        currency: 'USDC',
        amount: recipientAmount,
        reason: `MARKET_TO_MARKET: Release stablecoins to LP after confirmation`,
      });

      settlementActions.push({
        type: 'release_escrow',
        amount: recipientAmount,
        currency: 'USDC',
        reason: 'MARKET_TO_MARKET: Escrow released after confirmation',
      });

      settlementActions.push({
        type: 'close_contract',
        amount: recipientAmount,
        currency: input.toCurrency,
        reason: 'MARKET_TO_MARKET: Settlement complete (marketplace)',
      });
    }

    return {
      required: true,
      amount: recipientAmount,
      currency: 'USDC',
      source: stablecoinSource,
    };
  }

  // ─── Fallback Graph ────────────────────────────────────────────────────────

  /**
   * Build a deterministic fallback graph for the selected strategy.
   * No runtime replanning — all branches are compiled upfront.
   */
  private buildFallbackGraph(strategy: SettlementStrategy, input: PolicyEngineInput): FallbackGraph {
    switch (strategy) {
      case 'LOCAL_RAIL':
        return {
          primary: 'LOCAL_RAIL',
          fallbacks: [
            { condition: 'Reserve insufficient', strategy: 'CANCEL_REFUND', actions: ['Refund sender', 'No twin tokens minted'] },
          ],
        };

      case 'RESERVE_TO_RESERVE':
        return {
          primary: 'RESERVE_TO_RESERVE',
          fallbacks: [
            { condition: 'Receiver reserve insufficient at redemption', strategy: 'RESERVE_TO_MARKET', actions: ['Consume LP bandwidth for shortfall', 'Only shortfall amount uses LPs'] },
            { condition: 'No LP bandwidth available', strategy: 'CANCEL_REFUND', actions: ['Refund sender', 'Burn minted twin tokens'] },
          ],
        };

      case 'RESERVE_TO_MARKET':
        return {
          primary: 'RESERVE_TO_MARKET',
          fallbacks: [
            { condition: 'Treasury stablecoins insufficient', strategy: 'RESERVE_TO_MARKET', actions: ['Purchase stablecoins on marketplace'] },
            { condition: 'No LP fiat bandwidth for auto-settlement', strategy: 'RESERVE_TO_MARKET', actions: ['Create marketplace settlement order'] },
            { condition: 'No LP claims settlement order', strategy: 'CANCEL_REFUND', actions: ['Refund sender', 'Return stablecoins to treasury'] },
          ],
        };

      case 'MARKET_TO_RESERVE':
        return {
          primary: 'MARKET_TO_RESERVE',
          fallbacks: [
            { condition: 'No LP stablecoin bandwidth', strategy: 'MARKET_TO_RESERVE', actions: ['Purchase stablecoins on marketplace'] },
            { condition: 'Marketplace purchase fails', strategy: 'CANCEL_REFUND', actions: ['Refund sender'] },
          ],
        };

      case 'MARKET_TO_MARKET':
        return {
          primary: 'MARKET_TO_MARKET',
          fallbacks: [
            { condition: 'No LP stablecoin bandwidth in sender country', strategy: 'MARKET_TO_MARKET', actions: ['Purchase stablecoins on marketplace'] },
            { condition: 'No LP fiat bandwidth for auto-settlement', strategy: 'MARKET_TO_MARKET', actions: ['Create marketplace settlement order in receiver country'] },
            { condition: 'No LP claims settlement order', strategy: 'CANCEL_REFUND', actions: ['Refund sender', 'Return stablecoins to treasury'] },
          ],
        };
    }
  }

  // ─── Rollback Plan ────────────────────────────────────────────────────────

  /**
   * Build a deterministic rollback plan for the selected strategy.
   */
  private buildRollbackPlan(
    strategy: SettlementStrategy,
    treasuryActions: TreasuryAction[],
    liquidityActions: LiquidityAction[],
  ): RollbackPlan {
    const steps: RollbackStep[] = [];

    // Reverse treasury actions in reverse order
    for (const action of [...treasuryActions].reverse()) {
      steps.push({
        step: `Reverse: ${action.type}`,
        action: this.reverseTreasuryAction(action),
        condition: 'If execution fails after this action',
      });
    }

    // Reverse liquidity actions in reverse order
    for (const action of [...liquidityActions].reverse()) {
      steps.push({
        step: `Reverse: ${action.type}`,
        action: this.reverseLiquidityAction(action),
        condition: 'If execution fails after this action',
      });
    }

    return { steps };
  }

  private reverseTreasuryAction(action: TreasuryAction): string {
    switch (action.type) {
      case 'credit_fiat_reserve': return `Debit ${action.amount} ${action.currency} from ${action.country} fiat reserve`;
      case 'debit_fiat_reserve': return `Credit ${action.amount} ${action.currency} to ${action.country} fiat reserve`;
      case 'mint_twin_tokens': return `Burn ${action.amount} ${action.currency} twin tokens`;
      case 'burn_twin_tokens': return `Mint ${action.amount} ${action.currency} twin tokens`;
      case 'credit_stablecoin_reserve': return `Debit ${action.amount} ${action.currency} from stablecoin reserve`;
      case 'debit_stablecoin_reserve': return `Credit ${action.amount} ${action.currency} to stablecoin reserve`;
      default: return `Reverse ${action.type}`;
    }
  }

  private reverseLiquidityAction(action: LiquidityAction): string {
    switch (action.type) {
      case 'purchase_stablecoin': return `Sell ${action.amount} ${action.currency} back to marketplace`;
      case 'sell_stablecoin': return `Buy back ${action.amount} ${action.currency}`;
      case 'lock_stablecoin': return `Unlock ${action.amount} ${action.currency} from escrow`;
      case 'release_stablecoin': return `Re-lock ${action.amount} ${action.currency} in escrow`;
      case 'allocate_lp_bandwidth': return `Release ${action.amount} ${action.currency} LP bandwidth`;
      case 'release_lp_bandwidth': return `Re-allocate ${action.amount} ${action.currency} LP bandwidth`;
      default: return `Reverse ${action.type}`;
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

export const liquidityPolicyEngine = new LiquidityPolicyEngine();
