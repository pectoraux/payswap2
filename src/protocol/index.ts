/**
 * PaySwap Protocol Layer — domain semantics built on the kernel.
 *
 * The kernel coordinates distributed state transitions using evidence under
 * uncertainty. The protocol layer defines PaySwap-specific domain concepts:
 * obligations, escrow, auctions, disputes, treasury, settlement, etc.
 *
 * Obligations are a protocol concept — not a kernel primitive. The kernel can
 * coordinate transitions for supply chains, cloud orchestration, robotics,
 * manufacturing, or identity workflows without ever knowing what an obligation
 * is. Obligations are how PaySwap models "who owes what to whom."
 */
export { obligation, transitionObligation, transferFulfiller, isOverdue, isActive, ObligationStore, obligationStore, OBLIGATION_LABELS } from './obligation';
export type { Obligation, ObligationType, ObligationState, ObligationPriority } from './obligation';

export { settlementEscrowContract, collateralVaultContract, lpRegistryContract, merchantRegistryContract, twinTokenContract, liquidityPoolContract } from './contracts';
export { settlementEscrow, SettlementEscrow } from './settlement/escrow';
export type { EscrowEntry, EscrowState, EscrowTransition } from './settlement/escrow';
export { collateralVault, CollateralVault } from './settlement/collateral-vault';
export type { CollateralEntry, CollateralState } from './settlement/collateral-vault';
export { settlementCapacityVault, SettlementCapacityVault } from './settlement/capacity-vault';
export type { StakePosition } from './settlement/capacity-vault';
export { lpLifecycle, LPLifecycle } from './lp-lifecycle-manager';
export type { LPRecord, LPLifecycleState } from './lp-lifecycle-manager';
export { disputeEngine, DisputeEngine } from './settlement/dispute-engine';
export type { Dispute, DisputeState, DisputeOutcome, FraudType, DisputeEvidence } from './settlement/dispute-engine';
export { manualSettlementEngine, ManualSettlementEngine } from './settlement/manual-settlement';
export type { ManualSettlement, ManualSettlementState } from './settlement/manual-settlement';
export { merchantRegistry, MerchantRegistry } from './merchant-registry';
export type { MerchantRecord, MerchantTier, TierConfig } from './merchant-registry';
export { treasury, Treasury } from './treasury';
export type { TreasuryPosition, TreasuryRecommendation, TreasuryAction } from './treasury';
export { auctionEngine } from './settlement/auctions';
export { netSettlementEngine } from './settlement/net-settlement';
export { computeAuthorizedExposure, defaultExposureFactors } from './economics/authorized-exposure';
export { computeLPReputation, defaultLPReputation } from './economics/reputation';
export { computeExpectedCost, defaultExpectedCost } from './economics/expected-cost';
export { tierFromBond, getTierConfig, TRUST_TIERS } from './economics/trust-tiers';
export { createFiatProof, computeConfidence, effectiveLiquidity } from './economics/fiat-proof';
export { createAttestation, ATTESTATION_LABELS } from './economics/attestation';
export type { Attestation, AttestationKind } from './economics/attestation';
export { protocolScenarios, CONSTITUTIONAL_TESTS } from './scenarios';
export { runProtocolScenario, runAllProtocolScenarios, verifyConstitutional } from './runner';
export { fuzz } from './fuzz';

// Blockchain adapters ----------------------------------------------------------
export { blockchainRegistry, BlockchainAdapterRegistry } from './blockchains/adapter';
export type { BlockchainAdapter } from './blockchains/adapter';
export { stellarAdapter, StellarAdapter } from './blockchains/stellar/adapter';

// Chain adapters (next-gen, mode-switchable) -----------------------------------
// The new `src/protocol/chains/` module exposes a rich `ChainAdapter`
// interface with runtime mode switching (simulation ↔ live) and auto-
// registers Stellar as the default chain. Re-exported here for ergonomic
// single-import access. See `./chains/index.ts` for the full surface.
export * from './chains';

// Twin Token engine ------------------------------------------------------------
export { twinTokenEngine, TwinTokenEngine } from './twin-token/engine';
export type {
  TwinTokenAsset,
  TwinTokenBalance,
  TwinTokenOperation,
  TwinTokenOperationType,
  TwinTokenEscrowRecord,
  TwinTokenOperationFilter,
} from './twin-token/engine';

// Wallet service ---------------------------------------------------------------
export { walletService, WalletService } from './wallets/wallet-service';
export type {
  PaySwapAccount,
  Wallet,
  BlockchainAccount,
  WalletTransaction,
  WalletTransactionType,
  AccountType,
  WalletEventLike,
} from './wallets/wallet-service';

// Webhook engine ---------------------------------------------------------------
export { webhookEngine, WebhookEngine, DEFAULT_WEBHOOK_EVENTS, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_SIGNATURE_PREFIX } from './webhooks/engine';
export type { WebhookEndpoint, WebhookDelivery, WebhookDeliveryStatus } from './webhooks/engine';

// QR service -------------------------------------------------------------------
export { qrService, QRService } from './qr/qr-service';
export type { QRCode, QRType, QRInterval } from './qr/qr-service';

// Merchant platform ------------------------------------------------------------
export { merchantPlatform, MerchantPlatform, DEFAULT_API_KEY_SCOPES, DEFAULT_WEBHOOK_EVENT_TYPES } from './merchant/platform';
export type {
  MerchantAccount,
  MerchantState,
  ApiKey,
  TeamMember,
  Product,
  Invoice,
  InvoiceItem,
  InvoiceState,
  Customer,
  Refund,
  RefundState,
  MerchantSettings,
  MerchantAnalytics,
} from './merchant/platform';

// Payout service ---------------------------------------------------------------
export { payoutService, PayoutService } from './payouts/payout-service';
export type {
  PayoutMethod,
  PayoutState,
  PayoutQuote,
  Payout,
  PayoutDestination,
  PayoutStats,
} from './payouts/payout-service';

// Ledger module ----------------------------------------------------------------
export { ledgerEngine, LedgerEngine } from './ledger/engine';
export type {
  JournalFilter,
  AccountTrialBalance,
  TrialBalance,
  BalanceSheet,
  BalanceSheetGroup,
  IncomeStatement,
  IntegrityReport,
} from './ledger/engine';
export {
  reconcileTwinTokenBacking,
  reconcileEscrow,
  reconcilePayouts,
  reconcileMerchant,
  reconcileTreasury,
  dailyReconciliation,
} from './ledger/reconciliation';
export type {
  ReconcileResult,
  ReconcileDiscrepancy,
  DailyReconciliationInput,
  DailyReconciliationReport,
} from './ledger/reconciliation';
