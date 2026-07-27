/**
 * PaySwap Protocol — Rich Chain Abstraction Interface.
 *
 * This is the next-generation adapter surface (vs. the legacy
 * `src/protocol/blockchains/adapter.ts` `BlockchainAdapter`). It models the
 * full lifecycle of accounts, assets, trustlines, transfers, claimable
 * balances, escrow, sponsored reserves, fee-bump, multisig, sequence
 * management, ledger sync, and Soroban smart-contract preparation.
 *
 * Every chain (Stellar, EVM, Solana, …) implements `ChainAdapter` and
 * registers itself with `chainRegistry` (see `./registry.ts`). The protocol
 * layer talks to chains ONLY through this interface — never directly to a
 * chain SDK.
 *
 * ## Mode switching
 *
 * Every adapter declares a `ChainMode` — either `'simulation'` (in-process,
 * deterministic, no network) or `'live'` (real chain RPC). Adapters MUST
 * support `setMode(mode)` so the runtime can flip between sim and live
 * without code changes. Default is `'simulation'` for safety.
 *
 * ## Evidence contract
 *
 * Every successful on-chain operation produces a kernel `Evidence` with
 * `source: 'on_chain_state'`, `verificationLevel: 'cryptographic'`,
 * `reputation: 1.0`, and a `payload` containing at minimum `txHash`,
 * `ledger`, `operation`, and `network`. This lets the kernel reason about
 * on-chain state with cryptographic confidence.
 *
 * ## Failure model
 *
 * Operations NEVER throw — they return `{ success: false, error: string }`.
 * This makes the adapter safe to compose in async settlement flows without
 * try/catch noise.
 */
import type { Evidence } from '@/kernel/evidence';

// ============================================================================
// Modes
// ============================================================================

/** Every adapter declares whether it is simulating or talking to a real chain. */
export type ChainMode = 'simulation' | 'live';

/** Network identifier — Stellar uses testnet/mainnet; EVM chains add their own. */
export type ChainNetwork = 'testnet' | 'mainnet' | 'devnet' | 'custom';

// ============================================================================
// Memo + claim predicates (Stellar-shaped, but generic enough for EVM stubs)
// ============================================================================

export type ChainMemoKind = 'none' | 'text' | 'id' | 'hash' | 'return';

export interface ChainMemo {
  kind: ChainMemoKind;
  value?: string;
}

/**
 * Claim predicate — when a claimable balance can be claimed.
 * Mirrors Stellar's `Claimant.predicate` union (unconditional / before-time / and / or / not).
 */
export type ClaimPredicate =
  | { kind: 'unconditional' }
  | { kind: 'before_absolute_time'; absBefore: number } // unix seconds
  | { kind: 'before_relative_time'; seconds: number }
  | { kind: 'and'; left: ClaimPredicate; right: ClaimPredicate }
  | { kind: 'or'; left: ClaimPredicate; right: ClaimPredicate }
  | { kind: 'not'; inner: ClaimPredicate };

// ============================================================================
// Account + transaction + asset shapes
// ============================================================================

export interface ChainAccount {
  address: string;
  chain: string;
  sequence: string;           // sequence number (Stellar) or nonce (EVM) as string
  balances?: Record<string, number>; // assetKey -> amount
  signers?: ChainSigner[];
  thresholds?: { low: number; medium: number; high: number };
  sponsored?: boolean;
  exists: boolean;
}

export interface ChainSigner {
  key: string;
  weight: number;
  type: 'ed25519' | 'sha256_hash' | 'preauth_tx' | 'evm' | 'other';
}

export interface ChainAsset {
  code: string;
  issuer?: string;          // undefined for native asset
  native?: boolean;
  decimals?: number;
}

export interface ChainTransaction {
  txHash: string;
  chain: string;
  ledger: number;
  operation: string;
  source?: string;
  success: boolean;
  confirmed: boolean;
  memo?: ChainMemo;
  createdAt: number;
  network: ChainNetwork;
  raw?: unknown;
}

/**
 * Discriminated union of every chain operation the adapter understands.
 * Used to drive typed dispatch in higher-level settlement code.
 */
export type ChainOperation =
  | { op: 'createAccount'; address: string; startingBalance?: number }
  | { op: 'fundAccount'; address: string; assetCode: string; amount: number }
  | { op: 'registerAsset'; code: string; issuer: string; metadata?: Record<string, unknown> }
  | { op: 'issueAsset'; assetCode: string; amount: number; to: string }
  | { op: 'burnAsset'; assetCode: string; amount: number; from: string }
  | { op: 'createTrustline'; account: string; assetCode: string; issuer?: string; limit?: number }
  | { op: 'transfer'; assetCode: string; amount: number; from: string; to: string; memo?: ChainMemo }
  | { op: 'pathPayment'; sourceAsset: string; sourceAmount: number; destAsset: string; destMin: number; from: string; to: string; path?: string[] }
  | { op: 'createClaimableBalance'; assetCode: string; amount: number; source: string; claimants: { destination: string; predicate: ClaimPredicate }[] }
  | { op: 'claimBalance'; balanceId: string; claimant: string }
  | { op: 'createEscrow'; assetCode: string; amount: number; signer1: string; signer2: string; unlockTime?: number }
  | { op: 'releaseEscrow'; escrowAddress: string; to: string; amount: number; assetCode: string }
  | { op: 'sponsorReserve'; sponsored: string; sponsor: string; assetCode?: string }
  | { op: 'feeBump'; innerTxHash: string; feeSource: string; baseFee: number }
  | { op: 'addSigner'; account: string; signer: ChainSigner }
  | { op: 'removeSigner'; account: string; signerKey: string }
  | { op: 'setThresholds'; account: string; low: number; medium: number; high: number };

// ============================================================================
// Generic operation result
// ============================================================================

export interface ChainResult {
  success: boolean;
  txHash?: string;
  evidence?: Evidence;
  error?: string;
  ledger?: number;
  network?: ChainNetwork;
  mode?: ChainMode;
  /** Optional additional fields (escrowAddress, balanceId, sequence, etc.). */
  [key: string]: unknown;
}

export interface ChainVerifyResult extends ChainResult {
  confirmed?: boolean;
  transaction?: ChainTransaction;
}

export interface ChainBalanceResult extends ChainResult {
  balance?: number;
  assetCode?: string;
  address?: string;
}

export interface ChainHealthResult {
  chain: string;
  healthy: boolean;
  mode: ChainMode;
  latencyMs: number;
  network?: ChainNetwork;
  details?: Record<string, unknown>;
}

// ============================================================================
// ChainAdapter interface
// ============================================================================

export interface ChainAdapter {
  /** Unique chain identifier (e.g. 'stellar', 'ethereum', 'base'). */
  readonly chain: string;
  /** Current operating mode. */
  readonly mode: ChainMode;
  /** Network the adapter is configured for. */
  readonly network: ChainNetwork;
  /** True once the adapter has been initialized (server reachable / sim ready). */
  isInitialized: boolean;

  /** Switch between simulation and live. */
  setMode(mode: ChainMode): Promise<ChainResult>;

  // ------------------------------------------------------- account lifecycle
  createAccount(params: { address: string; startingBalance?: number; funder?: string }): Promise<ChainResult>;
  fundAccount(params: { address: string; assetCode: string; amount: number; funder?: string }): Promise<ChainResult>;

  // --------------------------------------------------------- asset lifecycle
  registerAsset(params: { code: string; issuer: string; metadata?: Record<string, unknown> }): Promise<ChainResult>;
  issueAsset(params: { assetCode: string; amount: number; to: string; issuer?: string }): Promise<ChainResult>;
  burnAsset(params: { assetCode: string; amount: number; from: string }): Promise<ChainResult>;

  // ------------------------------------------------------------- trustlines
  createTrustline(params: { account: string; assetCode: string; issuer?: string; limit?: number }): Promise<ChainResult>;

  // ---------------------------------------------------------------- transfers
  transfer(params: { assetCode: string; amount: number; from: string; to: string; memo?: ChainMemo; issuer?: string }): Promise<ChainResult>;
  pathPayment(params: {
    sourceAssetCode: string;
    sourceAmount: number;
    destAssetCode: string;
    destMin: number;
    from: string;
    to: string;
    path?: string[];
  }): Promise<ChainResult>;

  // --------------------------------------------------- claimable balances
  createClaimableBalance(params: {
    assetCode: string;
    amount: number;
    source: string;
    claimants: { destination: string; predicate: ClaimPredicate }[];
    issuer?: string;
  }): Promise<ChainResult & { balanceId?: string }>;
  claimBalance(params: { balanceId: string; claimant: string }): Promise<ChainResult>;
  getClaimableBalances(params: { account?: string; assetCode?: string }): Promise<ChainResult & { balances?: Array<{ balanceId: string; assetCode: string; amount: number; claimants: string[] }> }>;

  // -------------------------------------------------------------------- escrow
  createEscrowAccount(params: {
    assetCode: string;
    amount: number;
    signer1: string;
    signer2: string;
    unlockTime?: number;
  }): Promise<ChainResult & { escrowAddress?: string }>;
  releaseEscrow(params: { escrowAddress: string; to: string; amount: number; assetCode: string }): Promise<ChainResult>;

  // ------------------------------------------------------- sponsored reserves
  sponsorReserve(params: { sponsored: string; sponsor: string; assetCode?: string }): Promise<ChainResult>;

  // ------------------------------------------------------------- fee bump
  feeBumpTransaction(params: { innerTxHash: string; feeSource: string; baseFee: number }): Promise<ChainResult>;

  // --------------------------------------------------------------- multisig
  addSigner(params: { account: string; signer: ChainSigner }): Promise<ChainResult>;
  removeSigner(params: { account: string; signerKey: string }): Promise<ChainResult>;
  setThresholds(params: { account: string; low: number; medium: number; high: number }): Promise<ChainResult>;

  // ------------------------------------------------------------- verification
  verifyTransaction(params: { txHash: string }): Promise<ChainVerifyResult>;
  getTransaction(params: { txHash: string }): Promise<ChainVerifyResult>;

  // ----------------------------------------------------------- ledger sync
  getLatestLedger(): Promise<ChainResult & { ledger?: number; closeTime?: number }>;
  streamLedgers(callback: (ledger: { ledger: number; closeTime: number; txCount: number }) => void): () => void;
  getLedgerEntry(params: { key: string }): Promise<ChainResult & { value?: unknown }>;

  // ------------------------------------------------------------- sequence
  getSequence(params: { address: string }): Promise<ChainResult & { sequence?: string }>;
  incrementSequence(params: { address: string; delta?: number }): Promise<ChainResult & { sequence?: string }>;

  // --------------------------------------------------------------- balances
  getBalance(params: { address: string; assetCode: string; issuer?: string }): Promise<ChainBalanceResult>;
  getBalances(params: { address: string }): Promise<ChainResult & { balances?: Record<string, number> }>;

  // ------------------------------------------------------- soroban prep (stub)
  /**
   * Prepare a Soroban smart-contract transaction (sim + footprint injection).
   * Stub for chains without Soroban — returns a structured 'not_supported'
   * error so callers can feature-detect.
   */
  prepareSorobanTransaction(params: {
    contractId: string;
    method: string;
    args?: unknown[];
    source: string;
  }): Promise<ChainResult & { preparedXdr?: string }>;

  // ----------------------------------------------------- transaction recovery
  /**
   * Recover a transaction whose submission response was lost (network blip).
   * Idempotent — checks if the tx was included and returns its hash+evidence.
   */
  recoverTransaction(params: { txHash: string }): Promise<ChainVerifyResult>;

  // ------------------------------------------------- ledger reconciliation
  /**
   * Compare on-chain balances with the expected state. Returns discrepancies.
   */
  reconcileLedger(params: {
    expectedBalances: Array<{ address: string; assetCode: string; amount: number; issuer?: string }>;
  }): Promise<ChainResult & { discrepancies?: Array<{ address: string; assetCode: string; expected: number; actual: number }> }>;

  // ------------------------------------------------------------------ health
  healthCheck(): Promise<ChainHealthResult>;
}

// ============================================================================
// Adapter config (shared shape — chains extend as needed)
// ============================================================================

export interface ChainAdapterConfig {
  mode: ChainMode;
  network: ChainNetwork;
  /** Optional RPC/Horizon URL override. */
  endpoint?: string;
  /** Optional signing key (secret). NEVER logged. */
  secretKey?: string;
  /** Optional additional metadata. */
  metadata?: Record<string, unknown>;
}
