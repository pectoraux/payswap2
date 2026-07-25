/**
 * PaySwap Protocol — Polygon Adapter (STUB).
 *
 * Polygon PoS sidechain. Adapter shape mirrors Ethereum but with Polygon's
 * faster block cadence (~2s) and Bor/Heimdall finality model.
 *
 * Implementation pattern (when ready):
 *   - Same as EthereumAdapter but with Polygon RPC.
 *   - `getLatestLedger` returns Bor block number (fast cadence).
 *   - `verifyTransaction` waits for checkpoint finalization (~10 min on
 *     Heimdall) for high-value settlements; otherwise accepts Bor block
 *     inclusion.
 *   - ERC-20 helpers identical to Ethereum.
 *
 * Frozen-kernel compliance: imports only `ChainAdapter` type for typing.
 */
import type {
  ChainAdapter,
  AccountResult,
  BalanceResult,
  BalancesResult,
  ChainResult,
  ClaimableBalanceResult,
  ClaimableBalancesResult,
  CreateAccountParams,
  CreateClaimableBalanceParams,
  CreateEscrowAccountParams,
  CreateTrustlineParams,
  EscrowResult,
  FeeBumpParams,
  FundAccountParams,
  GetBalanceParams,
  GetLedgerEntryParams,
  HealthResult,
  IssueAssetParams,
  BurnAssetParams,
  LedgerEntryResult,
  LedgerResult,
  LedgerStreamCallback,
  AddSignerParams,
  RemoveSignerParams,
  SetThresholdsParams,
  PathPaymentParams,
  PathPaymentResult,
  RegisterAssetParams,
  ReleaseEscrowParams,
  SequenceResult,
  SponsorReserveParams,
  TransferParams,
  TxResult,
  VerifyResult,
  VerifyTransactionParams,
} from '../adapter';

const NOT_IMPLEMENTED = 'Polygon adapter not yet implemented';

/** Stub Polygon adapter — all methods return structured error shapes. */
export class PolygonAdapter implements ChainAdapter {
  readonly chain = 'polygon';
  readonly isInitialized = false;

  async createAccount(_params: CreateAccountParams): Promise<AccountResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async fundAccount(_params: FundAccountParams): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async registerAsset(_params: RegisterAssetParams): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async issueAsset(_params: IssueAssetParams): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async burnAsset(_params: BurnAssetParams): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async createTrustline(_params: CreateTrustlineParams): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async transfer(_params: TransferParams): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async pathPayment(_params: PathPaymentParams): Promise<PathPaymentResult> {
    return { success: false, error: NOT_IMPLEMENTED, receivedAmount: 0, path: [] };
  }
  async createClaimableBalance(_params: CreateClaimableBalanceParams): Promise<ClaimableBalanceResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async claimBalance(_params: { balanceId: string; claimant: string; memo?: import('../adapter').ChainMemo }): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async getClaimableBalances(_holder: string): Promise<ClaimableBalancesResult> {
    return { success: false, error: NOT_IMPLEMENTED, balances: [] };
  }
  async createEscrowAccount(_params: CreateEscrowAccountParams): Promise<EscrowResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async releaseEscrow(_params: ReleaseEscrowParams): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async sponsorReserve(_params: SponsorReserveParams): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async feeBumpTransaction(_params: FeeBumpParams): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async addSigner(_params: AddSignerParams): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async removeSigner(_params: RemoveSignerParams): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async setThresholds(_params: SetThresholdsParams): Promise<ChainResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async verifyTransaction(_params: VerifyTransactionParams): Promise<VerifyResult> {
    return { success: false, confirmed: false, error: NOT_IMPLEMENTED };
  }
  async getTransaction(_txHash: string): Promise<TxResult> {
    return { success: false, confirmed: false, error: NOT_IMPLEMENTED };
  }
  async getLatestLedger(): Promise<LedgerResult> {
    return { success: false, error: NOT_IMPLEMENTED, ledger: 0, closeTime: 0, txCount: 0 };
  }
  streamLedgers(_callback: LedgerStreamCallback): () => void {
    return () => { /* no-op */ };
  }
  async getLedgerEntry(_params: GetLedgerEntryParams): Promise<LedgerEntryResult> {
    return { success: false, error: NOT_IMPLEMENTED };
  }
  async getSequence(_address: string): Promise<SequenceResult> {
    return { success: false, error: NOT_IMPLEMENTED, sequence: 0 };
  }
  async incrementSequence(_address: string): Promise<SequenceResult> {
    return { success: false, error: NOT_IMPLEMENTED, sequence: 0 };
  }
  async getBalance(_params: GetBalanceParams): Promise<BalanceResult> {
    return { success: false, error: NOT_IMPLEMENTED, balance: 0 };
  }
  async getBalances(_address: string): Promise<BalancesResult> {
    return { success: false, error: NOT_IMPLEMENTED, balances: [] };
  }
  async healthCheck(): Promise<HealthResult> {
    return { healthy: false, latencyMs: 0, chain: this.chain, details: { reason: NOT_IMPLEMENTED } };
  }
}

/** Singleton Polygon adapter — usable once implemented. */
export const polygonChainAdapter = new PolygonAdapter();
