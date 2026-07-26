/**
 * PaySwap Protocol — Polygon Chain Adapter (Stub).
 *
 * Future-chain stub for Polygon PoS. All operations return a structured
 * `{ success: false, error }` — no JS throws. Real integration will use
 * `ethers.js` or `viem` against a Polygon RPC endpoint. Polygon shares the
 * EVM adapter shape — see `../ethereum/adapter.ts` for the ERC-20 helper
 * mapping.
 */
import type {
  ChainAdapter,
  ChainMode,
  ChainNetwork,
  ChainResult,
  ChainVerifyResult,
  ChainBalanceResult,
  ChainHealthResult,
  ChainMemo,
  ClaimPredicate,
  ChainSigner,
} from '../adapter';

const NOT_IMPLEMENTED = 'polygon adapter not yet implemented — use Stellar';

export class PolygonChainAdapter implements ChainAdapter {
  readonly chain = 'polygon';
  readonly mode: ChainMode = 'simulation';
  readonly network: ChainNetwork = 'mainnet';
  isInitialized = false;

  async setMode(_mode: ChainMode): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED, mode: this.mode, network: this.network };
  }

  async createAccount(_params: { address: string; startingBalance?: number; funder?: string }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async fundAccount(_params: { address: string; assetCode: string; amount: number; funder?: string }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async registerAsset(_params: { code: string; issuer: string; metadata?: Record<string, unknown> }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async issueAsset(_params: { assetCode: string; amount: number; to: string; issuer?: string }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async burnAsset(_params: { assetCode: string; amount: number; from: string }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async createTrustline(_params: { account: string; assetCode: string; issuer?: string; limit?: number }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async transfer(_params: { assetCode: string; amount: number; from: string; to: string; memo?: ChainMemo; issuer?: string }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async pathPayment(_params: {
    sourceAssetCode: string;
    sourceAmount: number;
    destAssetCode: string;
    destMin: number;
    from: string;
    to: string;
    path?: string[];
  }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async createClaimableBalance(_params: {
    assetCode: string;
    amount: number;
    source: string;
    claimants: { destination: string; predicate: ClaimPredicate }[];
    issuer?: string;
  }): Promise<ChainResult & { balanceId?: string }> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async claimBalance(_params: { balanceId: string; claimant: string }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async getClaimableBalances(_params: { account?: string; assetCode?: string }): Promise<ChainResult & { balances?: Array<{ balanceId: string; assetCode: string; amount: number; claimants: string[] }> }> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async createEscrowAccount(_params: {
    assetCode: string;
    amount: number;
    signer1: string;
    signer2: string;
    unlockTime?: number;
  }): Promise<ChainResult & { escrowAddress?: string }> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async releaseEscrow(_params: { escrowAddress: string; to: string; amount: number; assetCode: string }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async sponsorReserve(_params: { sponsored: string; sponsor: string; assetCode?: string }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async feeBumpTransaction(_params: { innerTxHash: string; feeSource: string; baseFee: number }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async addSigner(_params: { account: string; signer: ChainSigner }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async removeSigner(_params: { account: string; signerKey: string }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async setThresholds(_params: { account: string; low: number; medium: number; high: number }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async verifyTransaction(_params: { txHash: string }): Promise<ChainVerifyResult> {
    return { success: false, confirmed: false, error: NOT_IMPLEMENTED };
  }

  async getTransaction(_params: { txHash: string }): Promise<ChainVerifyResult> {
    return { success: false, confirmed: false, error: NOT_IMPLEMENTED };
  }

  async getLatestLedger(): Promise<ChainResult & { ledger?: number; closeTime?: number }> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  streamLedgers(_callback: (ledger: { ledger: number; closeTime: number; txCount: number }) => void): () => void {
    return () => { /* noop */ };
  }

  async getLedgerEntry(_params: { key: string }): Promise<ChainResult & { value?: unknown }> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async getSequence(_params: { address: string }): Promise<ChainResult & { sequence?: string }> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async incrementSequence(_params: { address: string; delta?: number }): Promise<ChainResult & { sequence?: string }> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async getBalance(_params: { address: string; assetCode: string; issuer?: string }): Promise<ChainBalanceResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async getBalances(_params: { address: string }): Promise<ChainResult & { balances?: Record<string, number> }> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async prepareSorobanTransaction(_params: {
    contractId: string;
    method: string;
    args?: unknown[];
    source: string;
  }): Promise<ChainResult & { preparedXdr?: string }> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async recoverTransaction(_params: { txHash: string }): Promise<ChainVerifyResult> {
    return { success: false, confirmed: false, error: NOT_IMPLEMENTED };
  }

  async reconcileLedger(_params: {
    expectedBalances: Array<{ address: string; assetCode: string; amount: number; issuer?: string }>;
  }): Promise<ChainResult & { discrepancies?: Array<{ address: string; assetCode: string; expected: number; actual: number }> }> {
    return { success: false, error: NOT_IMPLEMENTED };
  }

  async healthCheck(): Promise<ChainHealthResult> {
    return {
      chain: 'polygon',
      healthy: false,
      mode: this.mode,
      latencyMs: 0,
      network: this.network,
      details: { error: NOT_IMPLEMENTED },
    };
  }
}

export const polygonChainAdapter = new PolygonChainAdapter();
