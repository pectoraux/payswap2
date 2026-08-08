/**
 * PaySwap Protocol — Twin Token Engine.
 *
 * Twin Tokens are PaySwap's stablecoin-equivalent: each `TWIN<CCY>` is 1:1
 * backed by fiat reserves held by an LP in the corridor's destination country.
 * They are issued on Stellar via the registered adapter, escrowed during
 * settlement, and burned on redemption.
 *
 * The engine is a thin domain layer over `stellarAdapter`:
 *   - registerAsset(): define a TWIN<CCY> for a corridor + issuer
 *   - mint():         issuer mints → credits `to` on-chain + locally
 *   - burn():         holder burns → debits on-chain + locally
 *   - transfer():     on-chain transfer between holders
 *   - escrow():       local lock (available balance falls, balance unchanged)
 *   - releaseEscrow():on-chain transfer from escrow holder to recipient
 *   - freeze/unfreeze:compliance freeze — availableBalance = 0 while frozen
 *
 * All on-chain state lives in the adapter. The engine keeps a domain index of
 * assets, balances, escrows, and operations so protocol modules can query
 * without awaiting network calls.
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { stellarAdapter } from '@/protocol/blockchains/stellar/adapter';

export type TwinTokenOperationType = 'mint' | 'burn' | 'transfer' | 'escrow' | 'release';

export interface TwinTokenAsset {
  code: string;          // e.g. 'TWINGHS'
  currency: string;      // e.g. 'GHS'
  corridor: string;      // e.g. 'KENYA-GHANA'
  issuer: string;        // Stellar issuing account address
  totalSupply: number;
  registeredAt: number;
}

export interface TwinTokenBalance {
  holder: string;
  assetCode: string;
  balance: number;       // total held
  escrowed: number;      // locked in active escrows
  frozen: boolean;       // compliance freeze
}

export interface TwinTokenOperation {
  id: string;
  type: TwinTokenOperationType;
  assetCode: string;
  amount: number;
  from?: string;
  to?: string;
  escrowId?: string;
  txHash?: string;
  ts: number;
}

export interface TwinTokenEscrowRecord {
  id: string;
  assetCode: string;
  amount: number;
  holder: string;
  createdAt: number;
  released: boolean;
  releasedTo?: string;
}

export interface TwinTokenOperationFilter {
  type?: TwinTokenOperationType;
  assetCode?: string;
  holder?: string;
}

export class TwinTokenEngine {
  private assets = new Map<string, TwinTokenAsset>();
  private balances = new Map<string, TwinTokenBalance>();           // `${assetCode}:${holder}`
  private escrows = new Map<string, TwinTokenEscrowRecord>();
  private operations: TwinTokenOperation[] = [];

  // ------------------------------------------------------------- registerAsset
  registerAsset(currency: string, corridor: string, issuer: string): TwinTokenAsset {
    const code = `TWIN${currency}`;
    const existing = this.assets.get(code);
    if (existing) return existing;
    const asset: TwinTokenAsset = {
      code, currency, corridor, issuer,
      totalSupply: 0, registeredAt: Date.now(),
    };
    this.assets.set(code, asset);
    eventEngine.emit('twintoken.registered', { assetCode: code, currency, corridor, issuer }, 0);
    return asset;
  }

  // ---------------------------------------------------------------------- mint
  async mint(assetCode: string, amount: number, to: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const asset = this.assets.get(assetCode);
    if (!asset) return { success: false, error: 'asset_not_registered' };
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };
    // Issue to the issuer first (Stellar semantics), then transfer to recipient.
    const issue = await stellarAdapter.issueAsset({ assetCode, amount, issuer: asset.issuer });
    if (!issue.success || !issue.txHash) return { success: false, error: issue.error ?? 'issue_failed' };
    let txHash = issue.txHash;
    if (to !== asset.issuer) {
      const xfer = await stellarAdapter.transfer({ assetCode, amount, from: asset.issuer, to, memo: 'twin-token-mint' });
      if (!xfer.success || !xfer.txHash) return { success: false, error: xfer.error ?? 'transfer_failed' };
      txHash = xfer.txHash;
    }
    this.credit(to, assetCode, amount);
    asset.totalSupply = round(asset.totalSupply + amount, 7);
    this.recordOperation({ type: 'mint', assetCode, amount, to, txHash });
    eventEngine.emit('twintoken.minted', { assetCode, amount, to, txHash, totalSupply: asset.totalSupply }, 0);
    return { success: true, txHash };
  }

  // ---------------------------------------------------------------------- burn
  async burn(assetCode: string, amount: number, from: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const asset = this.assets.get(assetCode);
    if (!asset) return { success: false, error: 'asset_not_registered' };
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };
    const bal = this.getBalanceRecord(from, assetCode);
    if (bal.frozen) return { success: false, error: 'account_frozen' };
    const available = bal.balance - bal.escrowed;
    if (available < amount) return { success: false, error: 'insufficient_available_balance' };
    const res = await stellarAdapter.burnAsset({ assetCode, amount, from });
    if (!res.success || !res.txHash) return { success: false, error: res.error ?? 'burn_failed' };
    this.debit(from, assetCode, amount);
    asset.totalSupply = round(asset.totalSupply - amount, 7);
    this.recordOperation({ type: 'burn', assetCode, amount, from, txHash: res.txHash });
    eventEngine.emit('twintoken.burned', { assetCode, amount, from, txHash: res.txHash, totalSupply: asset.totalSupply }, 0);
    return { success: true, txHash: res.txHash };
  }

  // ------------------------------------------------------------------ transfer
  async transfer(assetCode: string, amount: number, from: string, to: string, memo?: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const asset = this.assets.get(assetCode);
    if (!asset) return { success: false, error: 'asset_not_registered' };
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };
    const bal = this.getBalanceRecord(from, assetCode);
    if (bal.frozen) return { success: false, error: 'account_frozen' };
    const available = bal.balance - bal.escrowed;
    if (available < amount) return { success: false, error: 'insufficient_available_balance' };
    const res = await stellarAdapter.transfer({ assetCode, amount, from, to, memo });
    if (!res.success || !res.txHash) return { success: false, error: res.error ?? 'transfer_failed' };
    this.debit(from, assetCode, amount);
    this.credit(to, assetCode, amount);
    this.recordOperation({ type: 'transfer', assetCode, amount, from, to, txHash: res.txHash });
    eventEngine.emit('twintoken.transferred', { assetCode, amount, from, to, memo, txHash: res.txHash }, 0);
    return { success: true, txHash: res.txHash };
  }

  // ------------------------------------------------------------------- escrow
  /** Lock `amount` from `from`'s available balance against `escrowId`. */
  async escrow(assetCode: string, amount: number, from: string, escrowId: string): Promise<{ success: boolean; error?: string }> {
    const asset = this.assets.get(assetCode);
    if (!asset) return { success: false, error: 'asset_not_registered' };
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };
    if (this.escrows.has(escrowId)) return { success: false, error: 'escrow_id_taken' };
    const bal = this.getBalanceRecord(from, assetCode);
    if (bal.frozen) return { success: false, error: 'account_frozen' };
    const available = bal.balance - bal.escrowed;
    if (available < amount) return { success: false, error: 'insufficient_available_balance' };
    bal.escrowed = round(bal.escrowed + amount, 7);
    const record: TwinTokenEscrowRecord = {
      id: escrowId, assetCode, amount, holder: from,
      createdAt: Date.now(), released: false,
    };
    this.escrows.set(escrowId, record);
    this.recordOperation({ type: 'escrow', assetCode, amount, from, escrowId });
    eventEngine.emit('twintoken.escrowed', { assetCode, amount, from, escrowId }, 0);
    return { success: true };
  }

  // -------------------------------------------------------------- releaseEscrow
  /** Release escrowed tokens to `to` via on-chain transfer from escrow holder. */
  async releaseEscrow(assetCode: string, amount: number, escrowId: string, to: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) return { success: false, error: 'escrow_not_found' };
    if (escrow.assetCode !== assetCode) return { success: false, error: 'asset_mismatch' };
    if (escrow.released) return { success: false, error: 'escrow_already_released' };
    if (escrow.amount < amount) return { success: false, error: 'insufficient_escrow_amount' };
    const res = await stellarAdapter.transfer({
      assetCode, amount, from: escrow.holder, to,
      memo: `escrow-release:${escrowId}`,
    });
    if (!res.success || !res.txHash) return { success: false, error: res.error ?? 'release_failed' };
    // Update balances: debit holder (balance + escrowed), credit recipient.
    const holderBal = this.getBalanceRecord(escrow.holder, assetCode);
    holderBal.balance = round(holderBal.balance - amount, 7);
    holderBal.escrowed = round(holderBal.escrowed - amount, 7);
    this.credit(to, assetCode, amount);
    if (escrow.amount === amount) {
      escrow.released = true;
      escrow.releasedTo = to;
    } else {
      escrow.amount = round(escrow.amount - amount, 7);
    }
    this.recordOperation({ type: 'release', assetCode, amount, from: escrow.holder, to, escrowId, txHash: res.txHash });
    eventEngine.emit('twintoken.released', { assetCode, amount, from: escrow.holder, to, escrowId, txHash: res.txHash }, 0);
    return { success: true, txHash: res.txHash };
  }

  // ------------------------------------------------------- freeze / unfreeze
  /** Compliance freeze — available balance for this holder becomes 0 across all assets. */
  freezeAccount(holder: string): void {
    for (const b of this.balances.values()) {
      if (b.holder === holder) b.frozen = true;
    }
  }

  unfreezeAccount(holder: string): void {
    for (const b of this.balances.values()) {
      if (b.holder === holder) b.frozen = false;
    }
  }

  // ----------------------------------------------------------------- queries
  getBalance(holder: string, assetCode: string): number {
    return this.getBalanceRecord(holder, assetCode).balance;
  }

  /** Available = balance − escrowed. If frozen, available = 0. */
  getAvailableBalance(holder: string, assetCode: string): number {
    const b = this.getBalanceRecord(holder, assetCode);
    if (b.frozen) return 0;
    return round(b.balance - b.escrowed, 7);
  }

  getBalanceRecord(holder: string, assetCode: string): TwinTokenBalance {
    const k = this.bkey(assetCode, holder);
    let b = this.balances.get(k);
    if (!b) {
      b = { holder, assetCode, balance: 0, escrowed: 0, frozen: false };
      this.balances.set(k, b);
    }
    return b;
  }

  getAsset(assetCode: string): TwinTokenAsset | undefined { return this.assets.get(assetCode); }
  allAssets(): TwinTokenAsset[] { return [...this.assets.values()]; }
  getEscrow(escrowId: string): TwinTokenEscrowRecord | undefined { return this.escrows.get(escrowId); }
  allEscrows(): TwinTokenEscrowRecord[] { return [...this.escrows.values()]; }

  getOperations(filter?: TwinTokenOperationFilter): TwinTokenOperation[] {
    if (!filter) return [...this.operations];
    return this.operations.filter((op) => {
      if (filter.type && op.type !== filter.type) return false;
      if (filter.assetCode && op.assetCode !== filter.assetCode) return false;
      if (filter.holder && op.from !== filter.holder && op.to !== filter.holder) return false;
      return true;
    });
  }

  /** Reset all in-memory state — used by tests + simulation reruns. */
  reset(): void {
    this.assets.clear();
    this.balances.clear();
    this.escrows.clear();
    this.operations = [];
  }

  // ----------------------------------------------------------------- helpers
  private bkey(assetCode: string, holder: string): string {
    return `${assetCode}:${holder}`;
  }

  private credit(holder: string, assetCode: string, amount: number): void {
    const b = this.getBalanceRecord(holder, assetCode);
    b.balance = round(b.balance + amount, 7);
  }

  private debit(holder: string, assetCode: string, amount: number): void {
    const b = this.getBalanceRecord(holder, assetCode);
    b.balance = round(b.balance - amount, 7);
  }

  private recordOperation(op: Omit<TwinTokenOperation, 'id' | 'ts'>): TwinTokenOperation {
    const full: TwinTokenOperation = { ...op, id: uid('ttop'), ts: Date.now() };
    this.operations.push(full);
    return full;
  }
}

export const twinTokenEngine = new TwinTokenEngine();
