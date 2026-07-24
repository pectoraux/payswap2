/**
 * PaySwap Protocol — Base (L2) Adapter (STUB).
 *
 * Base is an Ethereum L2 (OP Stack). Adapter shape mirrors Ethereum but
 * chain id and RPC differ. All methods return structured error results.
 *
 * Implementation pattern (when ready):
 *   - Same as EthereumAdapter but with L2 RPC + L1 gas-billing awareness.
 *   - `feeBumpTransaction` for L2 = increase L2 gas tip; L1 data fee is fixed.
 *   - `getLatestLedger` returns the L2 block (faster cadence ~2s vs 12s).
 *   - `verifyTransaction` should additionally check L1 finalization
 *     (optimistic-rollup challenge window ~7 days for full finality).
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

const NOT_IMPLEMENTED = 'Base adapter not yet implemented';

/** Stub Base adapter — all methods return structured error shapes. */
export class BaseAdapter implements ChainAdapter {
  readonly chain = 'base';
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

/** Singleton Base adapter — usable once implemented. */
export const baseChainAdapter = new BaseAdapter();
