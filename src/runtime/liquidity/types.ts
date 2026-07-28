/**
 * Liquidity Intelligence & Settlement Kernel — Types. (M-RT-30.)
 *
 * This is the "brain" of PaySwap — the liquidity operating system that
 * replaces the simplified settlement pipeline with the complete PaySwap
 * economic model:
 *
 *   Intent → Liquidity Policy → Execution Strategy → Treasury
 *          → Liquidity Network → Settlement → Recipient Confirmation
 *          → Finalization
 *
 * 5 settlement strategies based on reserve availability:
 *   1. LOCAL_RAIL          — same country, no stablecoins, no LPs
 *   2. RESERVE_TO_RESERVE   — both countries have fiat reserves
 *   3. RESERVE_TO_MARKET    — receiving country has no reserve
 *   4. MARKET_TO_RESERVE    — sending country has no reserve
 *   5. MARKET_TO_MARKET     — neither country has reserves
 *
 * Key concepts:
 *   - Bandwidth: first-class runtime asset (LP capacity for liquidity)
 *   - Escrow: stablecoins locked during settlement (never released before confirmation)
 *   - Bond: LP collateral that can be slashed
 *   - Settlement Contracts: lifecycle from Created → Closed
 *   - Fallback Graph: deterministic fallback branches in every plan
 *   - Twin Token backing: minted tokens == treasury reserves (always)
 */

// ─── Settlement Strategies ─────────────────────────────────────────────────

export type SettlementStrategy =
  | 'LOCAL_RAIL'
  | 'RESERVE_TO_RESERVE'
  | 'RESERVE_TO_MARKET'
  | 'MARKET_TO_RESERVE'
  | 'MARKET_TO_MARKET';

// ─── Liquidity Execution Plan ──────────────────────────────────────────────

/** A treasury action within a liquidity execution plan. */
export interface TreasuryAction {
  actionType: 'credit_reserve' | 'debit_reserve' | 'mint_twin' | 'burn_twin' | 'purchase_stablecoin' | 'sell_stablecoin' | 'lock_stablecoin' | 'release_stablecoin';
  accountId: string;
  currency: string;
  amount: number;
  reason: string;
}

/** A liquidity action (LP bandwidth usage). */
export interface LiquidityAction {
  actionType: 'lock_bandwidth' | 'release_bandwidth' | 'escrow_bandwidth' | 'slash_bandwidth';
  lpId: string;
  country: string;
  assetType: 'twin_token' | 'stablecoin';
  amount: number;
  reason: string;
}

/** A settlement action. */
export interface SettlementAction {
  actionType: 'create_contract' | 'fund_contract' | 'claim_contract' | 'confirm_contract' | 'release_escrow' | 'close_contract';
  contractId?: string;
  network: string;
  amount: number;
  currency: string;
  recipient: string;
  reason: string;
}

/** A fallback branch in the execution plan. */
export interface FallbackBranch {
  branchId: string;
  strategy: SettlementStrategy;
  description: string;
  conditions: string;
  treasuryActions: TreasuryAction[];
  liquidityActions: LiquidityAction[];
}

/** The fallback graph — deterministic fallback branches. */
export interface FallbackGraph {
  primary: SettlementStrategy;
  fallbacks: FallbackBranch[];
  finalFallback: 'refund' | 'cancel';
}

/** The complete liquidity execution plan. */
export interface LiquidityExecutionPlan {
  planId: string;
  intentId: string;
  strategy: SettlementStrategy;
  treasuryActions: TreasuryAction[];
  liquidityActions: LiquidityAction[];
  settlementActions: SettlementAction[];
  requiredBandwidth: number;
  requiredEscrow: number;
  reserveAware: boolean;
  stablecoinUsage: number;
  feeModel: FeeModel;
  fallbackGraph: FallbackGraph;
  rollbackPlan: RollbackStep[];
  createdAt: number;
}

/** Fee model for the plan. */
export interface FeeModel {
  payswapFeeBps: number;
  lpFeeBps: number;
  totalFeeBps: number;
  feeSplit: { lp: number; payswap: number }; // percentages
}

/** A rollback step (executed if the plan fails). */
export interface RollbackStep {
  step: number;
  action: string;
  description: string;
}

// ─── Bandwidth ─────────────────────────────────────────────────────────────

/** Bandwidth position — first-class runtime asset. */
export interface BandwidthPosition {
  owner: string; // LP ID
  country: string;
  assetType: 'twin_token' | 'stablecoin';
  capacity: number;
  reserved: number;
  used: number;
  available: number;
  escrow: number;
  bond: number;
  status: 'active' | 'suspended' | 'exhausted';
  participationMode: 'automatic' | 'manual';
}

// ─── Settlement Contract ───────────────────────────────────────────────────

export type SettlementContractStatus =
  | 'created' | 'funded' | 'claimed' | 'accepted'
  | 'awaiting_recipient' | 'confirmed' | 'released' | 'closed'
  | 'expired' | 'disputed';

export interface SettlementContract {
  contractId: string;
  fromCountry: string;
  toCountry: string;
  amount: number;
  currency: string;
  lpId: string | null;
  stablecoinAmount: number;
  stablecoinCurrency: string;
  status: SettlementContractStatus;
  escrowLocked: boolean;
  createdAt: number;
  fundedAt: number | null;
  claimedAt: number | null;
  confirmedAt: number | null;
  releasedAt: number | null;
  closedAt: number | null;
  expiresAt: number;
  disputeId: string | null;
}

// ─── Dispute ───────────────────────────────────────────────────────────────

export type DisputeStatus = 'open' | 'evaluating' | 'community_review' | 'arbitration' | 'resolved';

export interface SettlementDispute {
  disputeId: string;
  contractId: string;
  reason: string;
  evidence: DisputeEvidence[];
  status: DisputeStatus;
  resolution: 'lp_fault' | 'recipient_fault' | 'system_fault' | 'no_fault' | null;
  slashingApplied: boolean;
  createdAt: number;
  resolvedAt: number | null;
}

export interface DisputeEvidence {
  type: 'transaction_log' | 'bank_proof' | 'mobile_money_proof' | 'screenshot' | 'settlement_receipt' | 'recipient_confirmation';
  submittedBy: string;
  data: string;
  submittedAt: number;
}

// ─── Liquidity Intent ──────────────────────────────────────────────────────

/** The intent that flows into the Liquidity Policy Engine. */
export interface LiquidityIntent {
  intentId: string;
  fromCountry: string;
  toCountry: string;
  amount: number;
  currency: string;
  senderAccountId: string;
  recipientAccountId: string;
  /** Whether the sender country has a fiat reserve. */
  senderHasReserve: boolean;
  /** Whether the receiver country has a fiat reserve. */
  receiverHasReserve: boolean;
  /** Whether it's a same-country transfer. */
  isLocal: boolean;
}

// ─── Twin Token Backing ────────────────────────────────────────────────────

/** Twin token monetary model: minted tokens == treasury reserves. */
export interface TwinTokenBacking {
  currency: string;
  mintedTokens: number;
  fiatReserves: number;
  stablecoinReserves: number;
  totalReserves: number;
  backingRatio: number; // totalReserves / mintedTokens (should always be >= 1.0)
  isFullyBacked: boolean;
}
