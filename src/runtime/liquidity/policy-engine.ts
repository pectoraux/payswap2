/**
 * Liquidity Policy Engine — produces deterministic LiquidityExecutionPlans.
 * (M-RT-30.)
 *
 *   Intent → Liquidity Policy → Execution Strategy → Treasury
 *          → Liquidity Network → Settlement → Confirmation → Finalization
 *
 * The engine selects one of 5 strategies based on reserve availability:
 *   1. LOCAL_RAIL          — same country
 *   2. RESERVE_TO_RESERVE   — both countries have fiat reserves
 *   3. RESERVE_TO_MARKET    — receiving country has no reserve
 *   4. MARKET_TO_RESERVE    — sending country has no reserve
 *   5. MARKET_TO_MARKET     — neither country has reserves
 *
 * Every plan includes a deterministic FallbackGraph and RollbackPlan.
 *
 * Pure: same intent + treasury state → same plan. No side effects.
 */

import type {
  LiquidityIntent,
  LiquidityExecutionPlan,
  SettlementStrategy,
  TreasuryAction,
  LiquidityAction,
  SettlementAction,
  FallbackGraph,
  FallbackBranch,
  FeeModel,
  RollbackStep,
} from './types';
import { uid } from '../types';

/** Inputs to the Liquidity Policy Engine. */
export interface LiquidityPolicyEngineInputs {
  /** Get the available reserve for a country/currency. */
  getReserve: (country: string, currency: string) => number;
  /** Get the available stablecoin inventory. */
  getStablecoinInventory: (currency: string) => number;
  /** Get available LP bandwidth for a country. */
  getBandwidth: (country: string, assetType: 'twin_token' | 'stablecoin') => number;
}

/** Default fee model: 90% LP, 10% PaySwap for market strategies; 100% PaySwap for reserve strategies. */
function defaultFeeModel(strategy: SettlementStrategy): FeeModel {
  if (strategy === 'LOCAL_RAIL' || strategy === 'RESERVE_TO_RESERVE') {
    return { payswapFeeBps: 50, lpFeeBps: 0, totalFeeBps: 50, feeSplit: { lp: 0, payswap: 100 } };
  }
  return { payswapFeeBps: 10, lpFeeBps: 90, totalFeeBps: 100, feeSplit: { lp: 90, payswap: 10 } };
}

/**
 * LiquidityPolicyEngine — produces deterministic execution plans.
 *
 * Pure: same intent + treasury state → same plan. Never executes.
 */
export class LiquidityPolicyEngine {
  constructor(private inputs: LiquidityPolicyEngineInputs) {}

  /**
   * Compile an intent into a LiquidityExecutionPlan.
   *
   * Selects the strategy based on reserve availability, generates treasury
   * + liquidity + settlement actions, and builds a deterministic fallback graph.
   */
  compile(intent: LiquidityIntent): LiquidityExecutionPlan {
    const strategy = this.selectStrategy(intent);
    const treasuryActions = this.generateTreasuryActions(intent, strategy);
    const liquidityActions = this.generateLiquidityActions(intent, strategy);
    const settlementActions = this.generateSettlementActions(intent, strategy);
    const fallbackGraph = this.buildFallbackGraph(intent, strategy);
    const rollbackPlan = this.buildRollbackPlan(strategy);
    const feeModel = defaultFeeModel(strategy);

    const requiredBandwidth = liquidityActions
      .filter((a) => a.actionType === 'lock_bandwidth')
      .reduce((s, a) => s + a.amount, 0);

    const requiredEscrow = treasuryActions
      .filter((a) => a.actionType === 'lock_stablecoin')
      .reduce((s, a) => s + a.amount, 0);

    return {
      planId: uid('lep'),
      intentId: intent.intentId,
      strategy,
      treasuryActions,
      liquidityActions,
      settlementActions,
      requiredBandwidth,
      requiredEscrow,
      reserveAware: true,
      stablecoinUsage: requiredEscrow,
      feeModel,
      fallbackGraph,
      rollbackPlan,
      createdAt: Date.now(),
    };
  }

  /** Select the settlement strategy based on reserve availability. */
  private selectStrategy(intent: LiquidityIntent): SettlementStrategy {
    if (intent.isLocal) return 'LOCAL_RAIL';
    if (intent.senderHasReserve && intent.receiverHasReserve) return 'RESERVE_TO_RESERVE';
    if (intent.senderHasReserve && !intent.receiverHasReserve) return 'RESERVE_TO_MARKET';
    if (!intent.senderHasReserve && intent.receiverHasReserve) return 'MARKET_TO_RESERVE';
    return 'MARKET_TO_MARKET';
  }

  /** Generate treasury actions for the selected strategy. */
  private generateTreasuryActions(intent: LiquidityIntent, strategy: SettlementStrategy): TreasuryAction[] {
    const actions: TreasuryAction[] = [];
    const { fromCountry, toCountry, amount, currency } = intent;

    switch (strategy) {
      case 'LOCAL_RAIL':
        // Credit reserve, mint twin tokens, credit recipient.
        actions.push({ actionType: 'credit_reserve', accountId: `reserve_${fromCountry}`, currency, amount, reason: 'Credit sender reserve' });
        actions.push({ actionType: 'mint_twin', accountId: `treasury_${toCountry}`, currency, amount, reason: 'Mint twin tokens for recipient' });
        break;

      case 'RESERVE_TO_RESERVE':
        // Credit reserve A, mint country-B twin tokens, credit recipient.
        actions.push({ actionType: 'credit_reserve', accountId: `reserve_${fromCountry}`, currency, amount, reason: 'Credit sender reserve' });
        actions.push({ actionType: 'mint_twin', accountId: `treasury_${toCountry}`, currency, amount, reason: 'Mint twin tokens (reserve-backed)' });
        break;

      case 'RESERVE_TO_MARKET':
        // Credit reserve A, purchase stablecoins if needed, lock stablecoins.
        actions.push({ actionType: 'credit_reserve', accountId: `reserve_${fromCountry}`, currency, amount, reason: 'Credit sender reserve' });
        const stablecoinInventory = this.inputs.getStablecoinInventory(currency);
        if (stablecoinInventory < amount) {
          actions.push({ actionType: 'purchase_stablecoin', accountId: `treasury_stablecoin_${fromCountry}`, currency, amount: amount - stablecoinInventory, reason: 'Purchase stablecoins for settlement' });
        }
        actions.push({ actionType: 'lock_stablecoin', accountId: `treasury_stablecoin_${fromCountry}`, currency, amount, reason: 'Lock stablecoins for escrow' });
        break;

      case 'MARKET_TO_RESERVE':
        // Obtain stablecoins from LP bandwidth, mint twin tokens.
        actions.push({ actionType: 'purchase_stablecoin', accountId: `treasury_stablecoin_${fromCountry}`, currency, amount, reason: 'Obtain stablecoins via LP bandwidth' });
        actions.push({ actionType: 'mint_twin', accountId: `treasury_${toCountry}`, currency, amount, reason: 'Mint twin tokens (stablecoin-backed)' });
        break;

      case 'MARKET_TO_MARKET':
        // Obtain stablecoins, lock, sell in destination.
        actions.push({ actionType: 'purchase_stablecoin', accountId: `treasury_stablecoin_${fromCountry}`, currency, amount, reason: 'Obtain stablecoins via LP/marketplace' });
        actions.push({ actionType: 'lock_stablecoin', accountId: `treasury_stablecoin_${fromCountry}`, currency, amount, reason: 'Lock stablecoins for escrow' });
        actions.push({ actionType: 'sell_stablecoin', accountId: `treasury_stablecoin_${toCountry}`, currency, amount, reason: 'Sell stablecoins in destination market' });
        break;
    }

    return actions;
  }

  /** Generate liquidity actions (LP bandwidth usage). */
  private generateLiquidityActions(intent: LiquidityIntent, strategy: SettlementStrategy): LiquidityAction[] {
    const actions: LiquidityAction[] = [];

    switch (strategy) {
      case 'LOCAL_RAIL':
      case 'RESERVE_TO_RESERVE':
        // No LP bandwidth needed — reserves handle everything.
        break;

      case 'RESERVE_TO_MARKET':
        // LP bandwidth needed for settlement in destination country.
        actions.push({
          actionType: 'lock_bandwidth', lpId: 'auto_select', country: intent.toCountry,
          assetType: 'stablecoin', amount: intent.amount, reason: 'Lock LP bandwidth for settlement',
        });
        break;

      case 'MARKET_TO_RESERVE':
        // LP bandwidth needed for stablecoin acquisition in sender country.
        actions.push({
          actionType: 'lock_bandwidth', lpId: 'auto_select', country: intent.fromCountry,
          assetType: 'stablecoin', amount: intent.amount, reason: 'Lock LP bandwidth for stablecoin acquisition',
        });
        break;

      case 'MARKET_TO_MARKET':
        // LP bandwidth needed in both countries.
        actions.push({
          actionType: 'lock_bandwidth', lpId: 'auto_select', country: intent.fromCountry,
          assetType: 'stablecoin', amount: intent.amount, reason: 'Lock LP bandwidth (sender)',
        });
        actions.push({
          actionType: 'lock_bandwidth', lpId: 'auto_select', country: intent.toCountry,
          assetType: 'stablecoin', amount: intent.amount, reason: 'Lock LP bandwidth (receiver)',
        });
        break;
    }

    return actions;
  }

  /** Generate settlement actions. */
  private generateSettlementActions(intent: LiquidityIntent, strategy: SettlementStrategy): SettlementAction[] {
    const actions: SettlementAction[] = [];

    if (strategy === 'LOCAL_RAIL' || strategy === 'RESERVE_TO_RESERVE') {
      // Direct twin token credit — no settlement contract needed.
      actions.push({
        actionType: 'create_contract', network: 'internal', amount: intent.amount,
        currency: intent.currency, recipient: intent.recipientAccountId,
        reason: `Twin token credit (${strategy})`,
      });
    } else {
      // Full settlement contract lifecycle.
      actions.push({
        actionType: 'create_contract', network: 'stellar', amount: intent.amount,
        currency: intent.currency, recipient: intent.recipientAccountId,
        reason: `Settlement contract (${strategy})`,
      });
      actions.push({
        actionType: 'fund_contract', network: 'stellar', amount: intent.amount,
        currency: intent.currency, recipient: intent.recipientAccountId,
        reason: 'Fund escrow',
      });
      actions.push({
        actionType: 'release_escrow', network: 'stellar', amount: intent.amount,
        currency: intent.currency, recipient: intent.recipientAccountId,
        reason: 'Release escrow after recipient confirmation',
      });
      actions.push({
        actionType: 'close_contract', network: 'stellar', amount: intent.amount,
        currency: intent.currency, recipient: intent.recipientAccountId,
        reason: 'Close settlement contract',
      });
    }

    return actions;
  }

  /** Build a deterministic fallback graph. */
  private buildFallbackGraph(intent: LiquidityIntent, primaryStrategy: SettlementStrategy): FallbackGraph {
    const fallbacks: FallbackBranch[] = [];

    // Fallback 1: Try marketplace if reserve fails.
    if (primaryStrategy === 'RESERVE_TO_RESERVE' || primaryStrategy === 'LOCAL_RAIL') {
      fallbacks.push({
        branchId: 'fb_1', strategy: 'RESERVE_TO_MARKET',
        description: 'If reserves insufficient, use marketplace for stablecoin settlement',
        conditions: 'reserve_balance < amount',
        treasuryActions: [{ actionType: 'purchase_stablecoin', accountId: `treasury_stablecoin_${intent.fromCountry}`, currency: intent.currency, amount: intent.amount, reason: 'Fallback: purchase stablecoins' }],
        liquidityActions: [{ actionType: 'lock_bandwidth', lpId: 'auto_select', country: intent.toCountry, assetType: 'stablecoin', amount: intent.amount, reason: 'Fallback: LP bandwidth' }],
      });
    }

    // Fallback 2: Cross-border reserve.
    if (primaryStrategy !== 'MARKET_TO_MARKET') {
      fallbacks.push({
        branchId: 'fb_2', strategy: 'MARKET_TO_MARKET',
        description: 'If all reserves fail, use full marketplace settlement',
        conditions: 'all_reserves_insufficient',
        treasuryActions: [
          { actionType: 'purchase_stablecoin', accountId: `treasury_stablecoin_${intent.fromCountry}`, currency: intent.currency, amount: intent.amount, reason: 'Fallback: purchase stablecoins' },
          { actionType: 'lock_stablecoin', accountId: `treasury_stablecoin_${intent.fromCountry}`, currency: intent.currency, amount: intent.amount, reason: 'Fallback: lock escrow' },
        ],
        liquidityActions: [
          { actionType: 'lock_bandwidth', lpId: 'auto_select', country: intent.fromCountry, assetType: 'stablecoin', amount: intent.amount, reason: 'Fallback: sender bandwidth' },
          { actionType: 'lock_bandwidth', lpId: 'auto_select', country: intent.toCountry, assetType: 'stablecoin', amount: intent.amount, reason: 'Fallback: receiver bandwidth' },
        ],
      });
    }

    // Final fallback: refund.
    return {
      primary: primaryStrategy,
      fallbacks,
      finalFallback: 'refund',
    };
  }

  /** Build a rollback plan. */
  private buildRollbackPlan(strategy: SettlementStrategy): RollbackStep[] {
    const steps: RollbackStep[] = [
      { step: 1, action: 'unlock_bandwidth', description: 'Release any locked LP bandwidth' },
      { step: 2, action: 'unlock_stablecoins', description: 'Release locked stablecoin escrow' },
      { step: 3, action: 'burn_twin_tokens', description: 'Burn any minted twin tokens' },
      { step: 4, action: 'reverse_reserve_credit', description: 'Reverse any reserve credits' },
      { step: 5, action: 'close_contract_disputed', description: 'Close settlement contract as disputed' },
    ];

    // Simpler rollback for local rail.
    if (strategy === 'LOCAL_RAIL') {
      return [
        { step: 1, action: 'burn_twin_tokens', description: 'Burn minted twin tokens' },
        { step: 2, action: 'reverse_reserve_credit', description: 'Reverse reserve credit' },
      ];
    }

    return steps;
  }
}
