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
export { disputeEngine } from './settlement/disputes';
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
