/**
 * PaySwap Protocol — Ethereum Chain Adapter (Stub).
 *
 * Future-chain stub. All operations return a structured `{ success: false,
 * error }` — no JS throws. Real Ethereum integration will use `ethers.js`
 * or `viem` to talk to an L1 RPC node + the PaySwap ERC-20 twin-token
 * contract.
 *
 * ## ERC-20 shaped helpers (for future integration)
 *
 * When this adapter is fully wired, the mapping will be:
 *
 *   - createAccount         → no-op (EVM accounts are implicit; address derived from keypair)
 *   - fundAccount           → eth_sendTransaction (native ETH transfer)
 *   - registerAsset         → ERC-20 deploy: new ethers.ContractFactory(abi, bytecode, signer).deploy()
 *   - issueAsset            → ERC-20.mint(to, amount)        // contract.mint(to, amount)
 *   - burnAsset             → ERC-20.burn(from, amount)      // contract.burn(amount)
 *   - createTrustline       → no-op (ERC-20 has no trustline concept)
 *   - transfer              → ERC-20.transfer(to, amount)    // contract.transfer(to, amount)
 *   - pathPayment           → DEX swap via Uniswap V3 router (multicall)
 *   - createClaimableBalance→ not native to EVM — use escrow contract
 *   - claimBalance          → escrow contract.release(claimant)
 *   - createEscrowAccount   → deploy Escrow.sol with 2-of-2 Gnosis Safe + timeLock
 *   - releaseEscrow         → escrow.release(recipient)
 *   - sponsorReserve        → not applicable (EVM has no reserve sponsorship)
 *   - feeBumpTransaction    → not applicable (EVM fees are per-tx, not bumpable)
 *   - addSigner             → Safe.addOwnerWithThreshold(owner, threshold)
 *   - removeSigner          → Safe.removeOwner(prevOwner, owner, threshold)
 *   - setThresholds         → Safe.changeThreshold(threshold)
 *   - verifyTransaction     → eth_getTransactionReceipt(txHash)
 *   - getLatestLedger       → eth_blockNumber
 *   - streamLedgers         → poll eth_blockNumber on interval
 *   - getSequence           → eth_getTransactionCount(address, 'pending')
 *   - incrementSequence     → no-op (nonce auto-managed by signer)
 *   - getBalance            → ERC-20.balanceOf(address)
 *   - prepareSoroban…       → N/A (Soroban is Stellar-only)
 *
 * For now, return a structured 'not_implemented' error.
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

const NOT_IMPLEMENTED = 'ethereum adapter not yet implemented — use Stellar';

export class EthereumChainAdapter implements ChainAdapter {
  readonly chain = 'ethereum';
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
      chain: 'ethereum',
      healthy: false,
      mode: this.mode,
      latencyMs: 0,
      network: this.network,
      details: { error: NOT_IMPLEMENTED },
    };
  }
}

export const ethereumChainAdapter = new EthereumChainAdapter();
