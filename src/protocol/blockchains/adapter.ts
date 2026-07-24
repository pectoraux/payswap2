/**
 * PaySwap Protocol — Blockchain Adapter Interface.
 *
 * Do not hardcode Stellar. The adapter interface makes all blockchains
 * pluggable. Future chains (Ethereum, Base, Solana, XRPL, Polygon) plug in
 * without modifying protocol logic.
 *
 * The adapter only produces Evidence and executes protocol-authorized commands.
 * It cannot approve transactions, change balances, or release escrow.
 */
import type { Evidence } from '@/kernel/evidence';

export interface BlockchainAdapter {
  chain: string;
  isInitialized: boolean;

  /** Issue (mint) an asset on-chain. */
  issueAsset(params: {
    assetCode: string;
    amount: number;
    issuer: string;
  }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }>;

  /** Burn an asset on-chain. */
  burnAsset(params: {
    assetCode: string;
    amount: number;
    from: string;
  }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }>;

  /** Transfer an asset between accounts. */
  transfer(params: {
    assetCode: string;
    amount: number;
    from: string;
    to: string;
    memo?: string;
  }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }>;

  /** Verify a transaction on-chain. */
  verify(params: {
    txHash: string;
  }): Promise<{ success: boolean; confirmed: boolean; evidence?: Evidence; error?: string }>;

  /** Get balance of an account for an asset. */
  getBalance(params: {
    address: string;
    assetCode: string;
  }): Promise<{ success: boolean; balance: number; evidence?: Evidence; error?: string }>;

  /** Submit a raw transaction. */
  submitTransaction(params: {
    signedTx: string;
  }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }>;

  /** Create escrow account (multisig/time-locked). */
  createEscrow(params: {
    amount: number;
    assetCode: string;
    signer1: string;
    signer2: string;
    unlockTime?: number;
  }): Promise<{ success: boolean; escrowAddress?: string; evidence?: Evidence; error?: string }>;

  /** Health check. */
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;
}

/**
 * Blockchain Adapter Registry — manages all registered chains.
 * The protocol queries the registry; the registry delegates to the adapter.
 */
export class BlockchainAdapterRegistry {
  private adapters: Map<string, BlockchainAdapter> = new Map();

  register(adapter: BlockchainAdapter): void {
    this.adapters.set(adapter.chain, adapter);
  }

  get(chain: string): BlockchainAdapter | undefined {
    return this.adapters.get(chain);
  }

  all(): BlockchainAdapter[] {
    return [...this.adapters.values()];
  }

  chains(): string[] {
    return [...this.adapters.keys()];
  }

  isRegistered(chain: string): boolean {
    return this.adapters.has(chain);
  }
}

export const blockchainRegistry = new BlockchainAdapterRegistry();
