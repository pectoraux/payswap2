/**
 * PaySwap Protocol — Blockchain Adapter Abstraction.
 *
 * The protocol layer talks to external chains through a uniform adapter
 * interface. Every chain (Stellar, EVM, Solana, …) implements `BlockchainAdapter`
 * and registers itself with `blockchainRegistry`.
 *
 * Adapters are the only place where on-chain state is touched. All higher-level
 * protocol modules (twin tokens, wallets, settlement, escrow) compose adapter
 * calls into domain flows.
 *
 * The adapter is intentionally minimal: asset issuance, burn, transfer,
 * verification, balance lookup, raw submission, escrow creation, and a health
 * probe. Every operation returns a Promise and produces `Evidence` so the
 * kernel can reason about on-chain state with cryptographic confidence.
 */
import type { Evidence } from '@/kernel/evidence';

export interface BlockchainAdapter {
  chain: string;
  isInitialized: boolean;
  issueAsset(params: { assetCode: string; amount: number; issuer: string }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }>;
  burnAsset(params: { assetCode: string; amount: number; from: string }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }>;
  transfer(params: { assetCode: string; amount: number; from: string; to: string; memo?: string }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }>;
  verify(params: { txHash: string }): Promise<{ success: boolean; confirmed: boolean; evidence?: Evidence; error?: string }>;
  getBalance(params: { address: string; assetCode: string }): Promise<{ success: boolean; balance: number; evidence?: Evidence; error?: string }>;
  submitTransaction(params: { signedTx: string }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }>;
  createEscrow(params: { amount: number; assetCode: string; signer1: string; signer2: string; unlockTime?: number }): Promise<{ success: boolean; escrowAddress?: string; evidence?: Evidence; error?: string }>;
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;
  fundAccount(address: string, assetCode: string, amount: number): void;
}

export class BlockchainAdapterRegistry {
  private adapters = new Map<string, BlockchainAdapter>();
  register(a: BlockchainAdapter) { this.adapters.set(a.chain, a); }
  get(chain: string) { return this.adapters.get(chain); }
  all() { return [...this.adapters.values()]; }
}

export const blockchainRegistry = new BlockchainAdapterRegistry();
