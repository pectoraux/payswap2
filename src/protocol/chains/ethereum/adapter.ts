/**
 * PaySwap Protocol — Ethereum Adapter (STUB).
 *
 * Placeholder implementation of the ChainAdapter interface for Ethereum.
 * All methods return a structured error result (no JS throws) so callers
 * can pattern-match on `success` and degrade gracefully.
 *
 * When implementing for real, swap each method body with calls to a
 * real Ethereum client (e.g. `ethers.js` or `viem`):
 *
 *   ```ts
 *   // ERC-20 helpers (real implementation pattern):
 *   const erc20 = new Contract(issuer, ERC20_ABI, signer);
 *   // issueAsset  → erc20.mint(to, amount)
 *   // burnAsset   → erc20.burnFrom(from, amount)
 *   // transfer    → erc20.transfer(to, amount)
 *   // createTrustline → no-op (EVM uses approvals, not trustlines)
 *   //                     → erc20.approve(spender, amount) is the analog
 *   // createEscrowAccount → deploy Escrow.sol contract
 *   // sponsorReserve      → not applicable on EVM (no reserves)
 *   // feeBumpTransaction  → resubmit with higher gas price (EIP-1559)
 *   // addSigner / setThresholds → not native; use Safe (Gnosis) multisig
 *   // verifyTransaction   → provider.getTransactionReceipt(txHash)
 *   // getLatestLedger     → provider.getBlock('latest')
 *   // streamLedgers       → provider.on('block', cb)
 *   // getSequence         → provider.getTransactionCount(address)
 *   ```
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

const NOT_IMPLEMENTED = 'Ethereum adapter not yet implemented';

/** Stub Ethereum adapter — all methods return structured error shapes. */
export class EthereumAdapter implements ChainAdapter {
  readonly chain = 'ethereum';
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

/** Singleton Ethereum adapter — usable once implemented. */
export const ethereumChainAdapter = new EthereumAdapter();
