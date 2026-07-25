/**
 * PaySwap Protocol — Chain Abstraction Layer (CAL).
 *
 * A rich, chain-neutral interface every blockchain adapter implements.
 * The protocol layer never imports a concrete chain — it goes through the
 * ChainAdapter interface. New chains (Ethereum, Base, Polygon, Solana, …)
 * plug in by implementing this interface; no protocol code changes.
 *
 * Design principles:
 *   1. Chain-neutral. The same operation (transfer, escrow, sponsor) maps
 *      onto every chain even though the on-chain mechanics differ.
 *   2. Evidence-first. Every successful on-chain op produces a kernel
 *      `Evidence` with source `on_chain_state`, verificationLevel
 *      `cryptographic`, reputation 1.0. The kernel is the source of truth
 *      for trust — adapters never bypass it.
 *   3. Drop-in replaceable. Each adapter is shaped to mirror the host
 *      chain's production SDK (e.g. `stellar-sdk` Account, TransactionBuilder,
 *      Operation.payment, Operation.changeTrust, Operation.manageSellOffer).
 *      Swapping the in-process simulation for the real SDK is mechanical.
 *   4. Async + safe-fail. Methods return `{ success, ... }` shapes rather
 *      than throwing — callers can pattern-match without try/catch.
 *
 * Frozen-kernel compliance:
 *   - Imports `Evidence` and `createEvidence` from `@/kernel/evidence` only.
 *   - Never writes to kernel state.
 */
import type { Evidence } from '@/kernel/evidence';

/* ============================================================================
 * Memo — chain-neutral memo that maps to:
 *   Stellar  → MemoText / MemoId / MemoHash / MemoReturn
 *   Ethereum → calldata "data" field (text only — hash/return id encoded)
 *   Base     → same as Ethereum (L2)
 *   Polygon  → same as Ethereum (L2)
 * ========================================================================== */
export type MemoType = 'text' | 'id' | 'hash' | 'return';
export interface ChainMemo {
  type: MemoType;
  value: string;
}

/* ============================================================================
 * Asset — chain-neutral asset identifier.
 *   Stellar  → { code: 'USDC', issuer: 'GABC…' }   (native = XLM, issuer omitted)
 *   Ethereum → { code: 'USDC', issuer: '0xABC…' }  (native = ETH, issuer omitted)
 * ========================================================================== */
export interface ChainAsset {
  code: string;       // e.g. 'XLM', 'USDC', 'TWINGHS'
  issuer?: string;    // issuing account address; omitted for native asset
}

/* ============================================================================
 * Account — chain-neutral on-chain account.
 * ========================================================================== */
export interface ChainAccount {
  chain: string;
  address: string;
  publicKey?: string;
  secretKey?: string;       // simulated — NEVER present for real-key adapters
  sequence: number;         // Stellar: account sequence; EVM: nonce
  balances: Map<string, number>;
  /** Sponsor that pays reserves for this account (Stellar sponsored-reserves). */
  sponsor?: string;
  /** Multi-sig signers (Stellar) or owners (EVM multisig wallets). */
  signers?: Array<{ key: string; weight: number }>;
  /** Thresholds (Stellar: low/med/high; EVM: M-of-N). */
  thresholds?: { low: number; medium: number; high: number };
  /** Subentry count — used to compute minimum reserve (Stellar). */
  subentryCount?: number;
  /** Whether the account is frozen (compliance). */
  frozen?: boolean;
}

/* ============================================================================
 * Operation — a single op inside a transaction. Discriminated union so the
 * chain can serialize/deserialize accurately.
 * ========================================================================== */
export type ChainOperation =
  | { type: 'issue'; asset: ChainAsset; amount: number; to: string }
  | { type: 'burn'; asset: ChainAsset; amount: number; from: string }
  | { type: 'transfer'; asset: ChainAsset; amount: number; from: string; to: string }
  | { type: 'trustline'; asset: ChainAsset; holder: string; limit?: number }
  | { type: 'path_payment'; sendAsset: ChainAsset; sendMax: number; destAsset: ChainAsset; destAmount: number; from: string; to: string; path: ChainAsset[] }
  | { type: 'claimable_balance_create'; asset: ChainAsset; amount: number; from: string; claimant: string; predicate: ClaimPredicate }
  | { type: 'claimable_balance_claim'; balanceId: string; claimant: string }
  | { type: 'escrow_create'; asset: ChainAsset; amount: number; from: string; escrowAddress: string; signer1: string; signer2: string; unlockTime: number }
  | { type: 'escrow_release'; asset: ChainAsset; amount: number; escrowAddress: string; to: string }
  | { type: 'sponsor'; sponsored: string; reserveAmount: number }
  | { type: 'fee_bump'; innerTxHash: string; fee: number; sponsor: string }
  | { type: 'add_signer'; account: string; signerKey: string; weight: number }
  | { type: 'remove_signer'; account: string; signerKey: string }
  | { type: 'set_threshold'; account: string; low: number; medium: number; high: number };

/* ============================================================================
 * Claim predicate — copied from Stellar's ClaimantPredicate shape so the
 * real SDK's `Claimant` maps 1:1.
 * ========================================================================== */
export type ClaimPredicate =
  | { kind: 'unconditional' }
  | { kind: 'before'; time: number }            // unix ms
  | { kind: 'after'; time: number }
  | { kind: 'and'; left: ClaimPredicate; right: ClaimPredicate }
  | { kind: 'or'; left: ClaimPredicate; right: ClaimPredicate }
  | { kind: 'not'; predicate: ClaimPredicate };

/* ============================================================================
 * Transaction — chain-neutral transaction record.
 * ========================================================================== */
export interface ChainTransaction {
  txHash: string;
  chain: string;
  source: string;
  operations: ChainOperation[];
  memo?: ChainMemo;
  sequence: number;
  fee: number;
  ledger: number;                 // 0 if pending
  createdAt: number;
  status: 'pending' | 'confirmed' | 'failed';
  /** Signer keys (post-submission audit). */
  signatures?: string[];
  /** Fee-bump wrapper info, if any. */
  feeBump?: { sponsor: string; fee: number };
}

/* ============================================================================
 * Result shapes — every method returns one of these. Never throws.
 * ========================================================================== */
export interface ChainResult {
  success: boolean;
  txHash?: string;
  evidence?: Evidence;
  error?: string;
  /** Ledger number the tx was included in (post-confirmation). */
  ledger?: number;
  /** Sequence number consumed by source account. */
  sequence?: number;
  /** Fee charged (in native asset's smallest unit). */
  fee?: number;
}

export interface AccountResult extends ChainResult {
  account?: ChainAccount;
}
export interface BalanceResult extends ChainResult {
  balance: number;
  trustlineLimit?: number;
}
export interface BalancesResult extends ChainResult {
  balances: Array<{ asset: string; balance: number; limit?: number; issuer?: string }>;
}
export interface TxResult extends ChainResult {
  transaction?: ChainTransaction;
  confirmed: boolean;
}
export interface VerifyResult extends ChainResult {
  confirmed: boolean;
}
export interface EscrowResult extends ChainResult {
  escrowAddress?: string;
}
export interface ClaimableBalanceResult extends ChainResult {
  balanceId?: string;
}
export interface ClaimableBalancesResult extends ChainResult {
  balances: Array<{ balanceId: string; asset: ChainAsset; amount: number; claimant: string; predicate: ClaimPredicate }>;
}
export interface SequenceResult extends ChainResult {
  sequence: number;
}
export interface LedgerResult extends ChainResult {
  ledger: number;
  closeTime: number;
  txCount: number;
}
export interface LedgerEntryResult extends ChainResult {
  entry?: unknown;
}
export interface HealthResult {
  healthy: boolean;
  latencyMs: number;
  chain: string;
  details?: Record<string, unknown>;
}
export interface PathPaymentResult extends ChainResult {
  receivedAmount: number;
  path: ChainAsset[];
}

/* ============================================================================
 * Param shapes for every operation.
 * ========================================================================== */
export interface CreateAccountParams {
  /** Pre-computed address. If omitted, adapter generates one. */
  address?: string;
  /** Starting native-asset balance (XLM / ETH / MATIC). */
  nativeAmount: number;
  /** Sponsor that will pay reserves (Stellar sponsored-reserves). */
  sponsor?: string;
  memo?: ChainMemo;
}
export interface FundAccountParams {
  address: string;
  nativeAmount: number;
  memo?: ChainMemo;
}
export interface RegisterAssetParams {
  assetCode: string;
  issuer: string;
  metadata?: Record<string, unknown>;
}
export interface IssueAssetParams {
  assetCode: string;
  issuer: string;
  amount: number;
  to: string;
  memo?: ChainMemo;
}
export interface BurnAssetParams {
  assetCode: string;
  amount: number;
  from: string;
  issuer?: string;
  memo?: ChainMemo;
}
export interface CreateTrustlineParams {
  holder: string;
  assetCode: string;
  issuer: string;
  /** Trustline limit (omit = max). */
  limit?: number;
  /** Sponsor that pays the reserve for this trustline. */
  sponsor?: string;
  memo?: ChainMemo;
}
export interface TransferParams {
  assetCode: string;
  issuer?: string;
  amount: number;
  from: string;
  to: string;
  memo?: ChainMemo;
}
export interface PathPaymentParams {
  sendAsset: ChainAsset;
  sendMax: number;
  destAsset: ChainAsset;
  destAmount: number;
  from: string;
  to: string;
  /** Intermediate assets to route through (DEX hops). */
  path?: ChainAsset[];
  memo?: ChainMemo;
}
export interface CreateClaimableBalanceParams {
  asset: ChainAsset;
  amount: number;
  from: string;
  claimant: string;
  predicate: ClaimPredicate;
  memo?: ChainMemo;
}
export interface ClaimBalanceParams {
  balanceId: string;
  claimant: string;
  memo?: ChainMemo;
}
export interface CreateEscrowAccountParams {
  asset: ChainAsset;
  amount: number;
  from: string;
  signer1: string;
  signer2: string;
  /** Unix-ms timestamp after which release is permitted. */
  unlockTime: number;
  memo?: ChainMemo;
}
export interface ReleaseEscrowParams {
  escrowAddress: string;
  to: string;
  amount?: number;       // omit = release all
  memo?: ChainMemo;
}
export interface SponsorReserveParams {
  sponsor: string;
  sponsored: string;
  reserveAmount: number;
  memo?: ChainMemo;
}
export interface FeeBumpParams {
  innerTxHash: string;
  sponsor: string;
  fee: number;
}
export interface AddSignerParams {
  account: string;
  signerKey: string;
  weight: number;
  memo?: ChainMemo;
}
export interface RemoveSignerParams {
  account: string;
  signerKey: string;
  memo?: ChainMemo;
}
export interface SetThresholdsParams {
  account: string;
  low: number;
  medium: number;
  high: number;
  memo?: ChainMemo;
}
export interface GetBalanceParams {
  address: string;
  assetCode: string;
  issuer?: string;
}
export interface VerifyTransactionParams {
  txHash: string;
}
export interface GetLedgerEntryParams {
  key: string;
}

/* ============================================================================
 * Stream callback for ledger close events.
 * ========================================================================== */
export type LedgerStreamCallback = (ledger: LedgerResult) => void;

/* ============================================================================
 * ChainAdapter — the chain-neutral interface.
 * ========================================================================== */
export interface ChainAdapter {
  /* Identification */
  readonly chain: string;            // 'stellar' | 'ethereum' | 'base' | 'polygon' | ...
  readonly isInitialized: boolean;

  /* Account lifecycle */
  createAccount(params: CreateAccountParams): Promise<AccountResult>;
  fundAccount(params: FundAccountParams): Promise<ChainResult>;

  /* Asset lifecycle */
  registerAsset(params: RegisterAssetParams): Promise<ChainResult>;
  issueAsset(params: IssueAssetParams): Promise<ChainResult>;
  burnAsset(params: BurnAssetParams): Promise<ChainResult>;

  /* Trustlines */
  createTrustline(params: CreateTrustlineParams): Promise<ChainResult>;

  /* Transfers */
  transfer(params: TransferParams): Promise<ChainResult>;
  pathPayment(params: PathPaymentParams): Promise<PathPaymentResult>;

  /* Claimable balances */
  createClaimableBalance(params: CreateClaimableBalanceParams): Promise<ClaimableBalanceResult>;
  claimBalance(params: ClaimBalanceParams): Promise<ChainResult>;
  getClaimableBalances(holder: string): Promise<ClaimableBalancesResult>;

  /* Escrow */
  createEscrowAccount(params: CreateEscrowAccountParams): Promise<EscrowResult>;
  releaseEscrow(params: ReleaseEscrowParams): Promise<ChainResult>;

  /* Sponsored reserves */
  sponsorReserve(params: SponsorReserveParams): Promise<ChainResult>;

  /* Fee bump */
  feeBumpTransaction(params: FeeBumpParams): Promise<ChainResult>;

  /* Multi-signature */
  addSigner(params: AddSignerParams): Promise<ChainResult>;
  removeSigner(params: RemoveSignerParams): Promise<ChainResult>;
  setThresholds(params: SetThresholdsParams): Promise<ChainResult>;

  /* Verification & lookup */
  verifyTransaction(params: VerifyTransactionParams): Promise<VerifyResult>;
  getTransaction(txHash: string): Promise<TxResult>;

  /* Ledger sync */
  getLatestLedger(): Promise<LedgerResult>;
  streamLedgers(callback: LedgerStreamCallback): () => void;   // returns unsubscribe fn
  getLedgerEntry(params: GetLedgerEntryParams): Promise<LedgerEntryResult>;

  /* Sequence */
  getSequence(address: string): Promise<SequenceResult>;
  incrementSequence(address: string): Promise<SequenceResult>;

  /* Balance */
  getBalance(params: GetBalanceParams): Promise<BalanceResult>;
  getBalances(address: string): Promise<BalancesResult>;

  /* Health */
  healthCheck(): Promise<HealthResult>;
}

/**
 * Helper — convert a ChainAsset to a canonical "CODE:ISSUER" string for use
 * as a Map key (omitting issuer for native).
 */
export function assetKey(asset: ChainAsset): string {
  if (!asset.issuer || asset.code === 'XLM' || asset.code === 'ETH' || asset.code === 'MATIC') {
    return asset.code;
  }
  return `${asset.code}:${asset.issuer}`;
}

/** Build a ChainAsset from optional code+issuer (native when no issuer). */
export function makeAsset(code: string, issuer?: string): ChainAsset {
  return issuer ? { code, issuer } : { code };
}
