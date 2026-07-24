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
export { paymentLifecycle, PaymentLifecycle } from './payments/lifecycle';
export type { PaymentIntent, PaymentState, PaymentPriority, EvidenceRequirement } from './payments/lifecycle';
export { liquidityMarketplace, LiquidityMarketplace } from './liquidity/marketplace';
export type { LPProfile, LPCapacityQuote } from './liquidity/marketplace';
export { identityService, IdentityService } from './identity/service';
export type { Identity, IdentityState, IdentityType } from './identity/service';
export { governanceEngine, GovernanceEngine } from './governance/engine';
export type { GovernanceProposal, GovernanceProposalState, GovernanceAction } from './governance/engine';
export { ConnectorRegistry, connectorRegistry, BankConnector, BlockchainConnector, MobileMoneyConnector, PSPConnector, ExchangeConnector } from './connectors';
export type { Connector, ConnectorConfig, ConnectorType, ConnectorResult } from './connectors';
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
