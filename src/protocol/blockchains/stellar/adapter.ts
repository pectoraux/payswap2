/**
 * PaySwap Protocol — Stellar Adapter (Simulated).
 *
 * In-process simulation of the Stellar network. Real Stellar uses the Horizon
 * API + Soroban for smart contracts; this adapter mimics that surface area
 * synchronously inside the runtime so protocol modules can run end-to-end
 * without external network dependencies.
 *
 * Semantics mirrored from Stellar:
 *   - Assets are `Code:Issuer` pairs. Native XLM has issuer = 'native'.
 *   - Accounts must exist + hold a trustline to a non-native asset before
 *     receiving it. `transfer` auto-creates both for backward-compat with
 *     legacy tests that did not pre-fund accounts.
 *   - Every operation produces cryptographic-grade Evidence
 *     (source: 'on_chain_state', verificationLevel: 'cryptographic').
 *
 * State is kept in three maps: balances, transactions, and asset issuers.
 * `fundAccount` is the synchronous test-setup escape hatch.
 */
import type { BlockchainAdapter } from '@/protocol/blockchains/adapter';
import type { Evidence } from '@/kernel/evidence';
import { createEvidence } from '@/kernel/evidence';
import { uid, round } from '@/kernel/support';

interface StellarTxRecord {
  txHash: string;
  type: 'issue' | 'burn' | 'transfer' | 'submit' | 'escrow_create';
  assetCode: string;
  amount: number;
  from?: string;
  to?: string;
  memo?: string;
  ts: number;
  confirmed: boolean;
  escrowAddress?: string;
  signers?: string[];
  unlockTime?: number;
}

export class StellarAdapter implements BlockchainAdapter {
  chain = 'stellar';
  isInitialized = true;

  /** `${address}:${assetCode}` -> balance */
  private balances = new Map<string, number>();
  /** txHash -> record */
  private transactions = new Map<string, StellarTxRecord>();
  /** assetCode -> issuer (native XLM maps to 'native') */
  private assetIssuers = new Map<string, string>();
  /** escrowAddress -> record (for createEscrow lookups) */
  private escrowAddresses = new Map<string, StellarTxRecord>();

  // ---------------------------------------------------------------- issueAsset
  async issueAsset(params: { assetCode: string; amount: number; issuer: string }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }> {
    const { assetCode, amount, issuer } = params;
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };
    this.assetIssuers.set(assetCode, issuer);
    this.ensureAccount(issuer, assetCode);
    this.credit(issuer, assetCode, amount);
    const txHash = uid('stellarTx');
    const evidence = this.evidence({
      entityId: issuer,
      attestedAmount: amount,
      currency: assetCode,
      attester: 'stellar-network',
      payload: { op: 'issue', txHash, assetCode, amount, issuer },
    });
    this.transactions.set(txHash, {
      txHash, type: 'issue', assetCode, amount, to: issuer,
      ts: Date.now(), confirmed: true,
    });
    return { success: true, txHash, evidence };
  }

  // ----------------------------------------------------------------- burnAsset
  async burnAsset(params: { assetCode: string; amount: number; from: string }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }> {
    const { assetCode, amount, from } = params;
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };
    this.ensureAccount(from, assetCode);
    const bal = this.getBal(from, assetCode);
    if (bal < amount) return { success: false, error: 'insufficient_balance' };
    this.debit(from, assetCode, amount);
    const txHash = uid('stellarTx');
    const evidence = this.evidence({
      entityId: from,
      attestedAmount: amount,
      currency: assetCode,
      attester: 'stellar-network',
      payload: { op: 'burn', txHash, assetCode, amount, from },
    });
    this.transactions.set(txHash, {
      txHash, type: 'burn', assetCode, amount, from,
      ts: Date.now(), confirmed: true,
    });
    return { success: true, txHash, evidence };
  }

  // ------------------------------------------------------------------ transfer
  async transfer(params: { assetCode: string; amount: number; from: string; to: string; memo?: string }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }> {
    const { assetCode, amount, from, to, memo } = params;
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };
    // Backward-compat: auto-create accounts + trustlines on both sides.
    this.ensureAccount(from, assetCode);
    this.ensureAccount(to, assetCode);
    const bal = this.getBal(from, assetCode);
    if (bal < amount) return { success: false, error: 'insufficient_balance' };
    this.debit(from, assetCode, amount);
    this.credit(to, assetCode, amount);
    const txHash = uid('stellarTx');
    const evidence = this.evidence({
      entityId: to,
      attestedAmount: amount,
      currency: assetCode,
      attester: 'stellar-network',
      payload: { op: 'transfer', txHash, assetCode, amount, from, to, memo },
    });
    this.transactions.set(txHash, {
      txHash, type: 'transfer', assetCode, amount, from, to, memo,
      ts: Date.now(), confirmed: true,
    });
    return { success: true, txHash, evidence };
  }

  // -------------------------------------------------------------------- verify
  async verify(params: { txHash: string }): Promise<{ success: boolean; confirmed: boolean; evidence?: Evidence; error?: string }> {
    const { txHash } = params;
    const tx = this.transactions.get(txHash);
    if (!tx) return { success: false, confirmed: false, error: 'tx_not_found' };
    const evidence = this.evidence({
      entityId: tx.from ?? tx.to ?? 'stellar-network',
      attestedAmount: tx.amount,
      currency: tx.assetCode,
      attester: 'stellar-network',
      payload: { op: 'verify', txHash, type: tx.type, confirmed: tx.confirmed },
    });
    return { success: true, confirmed: tx.confirmed, evidence };
  }

  // ----------------------------------------------------------------- getBalance
  async getBalance(params: { address: string; assetCode: string }): Promise<{ success: boolean; balance: number; evidence?: Evidence; error?: string }> {
    const { address, assetCode } = params;
    const balance = this.getBal(address, assetCode);
    const evidence = this.evidence({
      entityId: address,
      attestedAmount: balance,
      currency: assetCode,
      attester: 'stellar-network',
      payload: { op: 'getBalance', address, assetCode, balance },
    });
    return { success: true, balance, evidence };
  }

  // ------------------------------------------------------------- submitTransaction
  async submitTransaction(params: { signedTx: string }): Promise<{ success: boolean; txHash?: string; evidence?: Evidence; error?: string }> {
    const { signedTx } = params;
    if (!signedTx || signedTx.length === 0) return { success: false, error: 'empty_signed_tx' };
    const txHash = uid('stellarTx');
    const evidence = this.evidence({
      entityId: 'stellar-network',
      attester: 'stellar-network',
      payload: { op: 'submit', txHash, signedTxLen: signedTx.length },
    });
    this.transactions.set(txHash, {
      txHash, type: 'submit', assetCode: 'native', amount: 0,
      ts: Date.now(), confirmed: true,
    });
    return { success: true, txHash, evidence };
  }

  // ---------------------------------------------------------------- createEscrow
  async createEscrow(params: { amount: number; assetCode: string; signer1: string; signer2: string; unlockTime?: number }): Promise<{ success: boolean; escrowAddress?: string; evidence?: Evidence; error?: string }> {
    const { amount, assetCode, signer1, signer2, unlockTime } = params;
    if (amount < 0) return { success: false, error: 'amount_must_be_non_negative' };
    const escrowAddress = uid('escrowAcct');
    this.ensureAccount(escrowAddress, assetCode);
    const txHash = uid('stellarTx');
    const record: StellarTxRecord = {
      txHash, type: 'escrow_create', assetCode, amount,
      ts: Date.now(), confirmed: true,
      escrowAddress, signers: [signer1, signer2], unlockTime,
    };
    this.transactions.set(txHash, record);
    this.escrowAddresses.set(escrowAddress, record);
    const evidence = this.evidence({
      entityId: escrowAddress,
      attestedAmount: amount,
      currency: assetCode,
      attester: 'stellar-network',
      payload: { op: 'createEscrow', txHash, escrowAddress, assetCode, amount, signers: [signer1, signer2], unlockTime },
    });
    return { success: true, escrowAddress, evidence };
  }

  // ----------------------------------------------------------------- healthCheck
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    // Simulated probe — in production this would hit Horizon /health.
    const latency = Math.max(1, Date.now() - start);
    return { healthy: true, latencyMs: latency };
  }

  // ----------------------------------------------------------------- fundAccount
  /** Synchronous test-setup helper — credits a local gift balance directly. */
  fundAccount(address: string, assetCode: string, amount: number): void {
    if (amount <= 0) return;
    this.ensureAccount(address, assetCode);
    this.credit(address, assetCode, amount);
  }

  // =============================================================== internal API

  /** Look up the registered issuer for an asset code. */
  getAssetIssuer(assetCode: string): string | undefined {
    return this.assetIssuers.get(assetCode);
  }

  /** All recorded transactions (for inspection / debugging). */
  getTransactionHistory(): StellarTxRecord[] {
    return [...this.transactions.values()];
  }

  /** Snapshot of all balances — primarily for assertions in tests. */
  getBalances(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.balances) out[k] = v;
    return out;
  }

  // ----------------------------------------------------------------- helpers
  private key(address: string, assetCode: string): string {
    return `${address}:${assetCode}`;
  }

  private getBal(address: string, assetCode: string): number {
    return this.balances.get(this.key(address, assetCode)) ?? 0;
  }

  private credit(address: string, assetCode: string, amount: number): void {
    const k = this.key(address, assetCode);
    this.balances.set(k, round((this.balances.get(k) ?? 0) + amount, 7));
  }

  private debit(address: string, assetCode: string, amount: number): void {
    const k = this.key(address, assetCode);
    this.balances.set(k, round((this.balances.get(k) ?? 0) - amount, 7));
  }

  /** Auto-create account + trustline (initialized to 0) if missing. */
  private ensureAccount(address: string, assetCode: string): void {
    const k = this.key(address, assetCode);
    if (!this.balances.has(k)) this.balances.set(k, 0);
  }

  private evidence(params: {
    entityId: string;
    attester: string;
    attestedAmount?: number;
    currency?: string;
    payload: Record<string, unknown>;
  }): Evidence {
    return createEvidence({
      type: 'observation',
      source: 'on_chain_state',
      verificationLevel: 'cryptographic',
      entityId: params.entityId,
      attestedAmount: params.attestedAmount,
      currency: params.currency,
      attester: params.attester,
      reputation: 1.0,
      payload: params.payload,
    });
  }
}

export const stellarAdapter = new StellarAdapter();
