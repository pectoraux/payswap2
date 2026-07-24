/**
 * PaySwap Protocol — Twin Token Module.
 *
 * Production Twin Tokens backed by Stellar (first chain).
 * The application never knows which blockchain is used — it goes through
 * the BlockchainAdapter interface.
 *
 * Support: mint, burn, transfer, escrow, freeze, reserve, metadata, compliance hooks.
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { stellarAdapter } from '../blockchains/stellar/adapter';
import { blockchainRegistry } from '../blockchains/adapter';

export interface TwinTokenAsset {
  code: string;       // e.g., "TWINGHS"
  currency: string;   // e.g., "GHS"
  issuer: string;     // Stellar issuer address
  totalSupply: number;
  circulating: number;
  escrowed: number;
  frozen: number;
  metadata: {
    peggedTo: string;
    corridor: string;
    createdAt: number;
  };
}

export interface TwinTokenBalance {
  holder: string;
  assetCode: string;
  balance: number;
  escrowed: number;
  frozen: number;
  available: number;
}

export interface TwinTokenOperation {
  id: string;
  type: 'mint' | 'burn' | 'transfer' | 'escrow' | 'freeze' | 'unfreeze' | 'reserve' | 'release';
  assetCode: string;
  amount: number;
  from?: string;
  to?: string;
  txHash?: string;
  evidence?: { source: string; confidence: number };
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: number;
  memo?: string;
}

export class TwinTokenEngine {
  private assets: Map<string, TwinTokenAsset> = new Map();
  private balances: Map<string, TwinTokenBalance> = new Map(); // key: holder:assetCode
  private operations: TwinTokenOperation[] = [];
  private frozenAccounts: Set<string> = new Set(); // compliance freezes

  /** Register a new Twin Token asset for a currency corridor. */
  async registerAsset(currency: string, corridor: string, issuer: string): Promise<TwinTokenAsset> {
    const code = `TWIN${currency}`;
    const asset: TwinTokenAsset = {
      code, currency, issuer,
      totalSupply: 0, circulating: 0, escrowed: 0, frozen: 0,
      metadata: { peggedTo: currency, corridor, createdAt: Date.now() },
    };
    this.assets.set(code, asset);
    eventEngine.emit('twintoken.registered', { code, currency, corridor, issuer }, 0);
    return asset;
  }

  /** Mint Twin Tokens (backed by liquidity). */
  async mint(assetCode: string, amount: number, to: string): Promise<TwinTokenOperation> {
    const asset = this.assets.get(assetCode);
    if (!asset) throw new Error(`Unknown asset: ${assetCode}`);

    const op: TwinTokenOperation = {
      id: uid('tt_op'), type: 'mint', assetCode, amount, to,
      status: 'pending', timestamp: Date.now(),
    };

    try {
      // Issue on Stellar to the issuer, then transfer to the recipient
      const issueResult = await stellarAdapter.issueAsset({
        assetCode, amount, issuer: asset.issuer,
      });

      if (issueResult.success && issueResult.evidence) {
        // Transfer from issuer to recipient on Stellar
        const transferResult = await stellarAdapter.transfer({
          assetCode, amount, from: asset.issuer, to, memo: 'Twin Token mint',
        });

        if (transferResult.success) {
          op.txHash = transferResult.txHash;
          op.evidence = { source: transferResult.evidence?.source ?? 'on_chain_state', confidence: transferResult.evidence?.reputation ?? 1.0 };
          op.status = 'confirmed';

          // Update supply
          asset.totalSupply = round(asset.totalSupply + amount, 6);
          asset.circulating = round(asset.circulating + amount, 6);

          // Update balance
          this.creditBalance(to, assetCode, amount);
        } else {
          op.status = 'failed';
        }
      } else {
        op.status = 'failed';
      }
    } catch (e) {
      op.status = 'failed';
    }

    this.operations.push(op);
    eventEngine.emit('twintoken.minted', { opId: op.id, assetCode, amount, to, txHash: op.txHash }, 0);
    return op;
  }

  /** Burn Twin Tokens (settlement complete). */
  async burn(assetCode: string, amount: number, from: string): Promise<TwinTokenOperation> {
    const asset = this.assets.get(assetCode);
    if (!asset) throw new Error(`Unknown asset: ${assetCode}`);
    if (this.getAvailableBalance(from, assetCode) < amount) throw new Error('Insufficient balance');

    const op: TwinTokenOperation = {
      id: uid('tt_op'), type: 'burn', assetCode, amount, from,
      status: 'pending', timestamp: Date.now(),
    };

    try {
      const result = await stellarAdapter.burnAsset({ assetCode, amount, from });
      if (result.success && result.evidence) {
        op.txHash = result.txHash;
        op.evidence = { source: result.evidence.source, confidence: result.evidence.reputation ?? 1.0 };
        op.status = 'confirmed';
        asset.totalSupply = round(asset.totalSupply - amount, 6);
        asset.circulating = round(asset.circulating - amount, 6);
        this.debitBalance(from, assetCode, amount);
      } else {
        op.status = 'failed';
      }
    } catch (e) {
      op.status = 'failed';
    }

    this.operations.push(op);
    eventEngine.emit('twintoken.burned', { opId: op.id, assetCode, amount, from, txHash: op.txHash }, 0);
    return op;
  }

  /** Transfer Twin Tokens between accounts. */
  async transfer(assetCode: string, amount: number, from: string, to: string, memo?: string): Promise<TwinTokenOperation> {
    if (this.getAvailableBalance(from, assetCode) < amount) throw new Error('Insufficient balance');
    if (this.frozenAccounts.has(from)) throw new Error('Account is compliance-frozen');

    const op: TwinTokenOperation = {
      id: uid('tt_op'), type: 'transfer', assetCode, amount, from, to, memo,
      status: 'pending', timestamp: Date.now(),
    };

    try {
      const result = await stellarAdapter.transfer({ assetCode, amount, from, to, memo });
      if (result.success && result.evidence) {
        op.txHash = result.txHash;
        op.evidence = { source: result.evidence.source, confidence: result.evidence.reputation ?? 1.0 };
        op.status = 'confirmed';
        this.debitBalance(from, assetCode, amount);
        this.creditBalance(to, assetCode, amount);
      } else {
        op.status = 'failed';
      }
    } catch (e) {
      op.status = 'failed';
    }

    this.operations.push(op);
    eventEngine.emit('twintoken.transferred', { opId: op.id, assetCode, amount, from, to, txHash: op.txHash }, 0);
    return op;
  }

  /** Escrow Twin Tokens (freeze for settlement). */
  async escrow(assetCode: string, amount: number, from: string, escrowId: string): Promise<TwinTokenOperation> {
    if (this.getAvailableBalance(from, assetCode) < amount) throw new Error('Insufficient balance');

    const op: TwinTokenOperation = {
      id: uid('tt_op'), type: 'escrow', assetCode, amount, from, to: escrowId,
      status: 'pending', timestamp: Date.now(),
    };

    // Lock locally (on-chain: create escrow account)
    const asset = this.assets.get(assetCode);
    if (asset) {
      asset.circulating = round(asset.circulating - amount, 6);
      asset.escrowed = round(asset.escrowed + amount, 6);
    }
    const balance = this.getOrCreateBalance(from, assetCode);
    balance.balance = round(balance.balance - amount, 6);
    balance.escrowed = round(balance.escrowed + amount, 6);

    op.status = 'confirmed';
    this.operations.push(op);
    eventEngine.emit('twintoken.escrowed', { opId: op.id, assetCode, amount, from, escrowId }, 0);
    return op;
  }

  /** Release escrowed Twin Tokens (settlement complete → release to LP). */
  async releaseEscrow(assetCode: string, amount: number, escrowId: string, to: string): Promise<TwinTokenOperation> {
    const op: TwinTokenOperation = {
      id: uid('tt_op'), type: 'release', assetCode, amount, from: escrowId, to,
      status: 'pending', timestamp: Date.now(),
    };

    const asset = this.assets.get(assetCode);
    if (asset) {
      asset.escrowed = round(asset.escrowed - amount, 6);
      asset.circulating = round(asset.circulating + amount, 6);
    }
    this.creditBalance(to, assetCode, amount);

    op.status = 'confirmed';
    this.operations.push(op);
    eventEngine.emit('twintoken.released', { opId: op.id, assetCode, amount, escrowId, to }, 0);
    return op;
  }

  /** Freeze an account (compliance). */
  freezeAccount(holder: string): void {
    this.frozenAccounts.add(holder);
    eventEngine.emit('twintoken.account_frozen', { holder }, 0);
  }

  /** Unfreeze an account. */
  unfreezeAccount(holder: string): void {
    this.frozenAccounts.delete(holder);
    eventEngine.emit('twintoken.account_unfrozen', { holder }, 0);
  }

  /** Get balance for a holder. */
  getBalance(holder: string, assetCode: string): TwinTokenBalance | undefined {
    return this.balances.get(`${holder}:${assetCode}`);
  }

  /** Get available (non-escrowed, non-frozen) balance. */
  getAvailableBalance(holder: string, assetCode: string): number {
    if (this.frozenAccounts.has(holder)) return 0;
    const bal = this.balances.get(`${holder}:${assetCode}`);
    return bal ? bal.available : 0;
  }

  /** Get all operations. */
  getOperations(filter?: { assetCode?: string; holder?: string }): TwinTokenOperation[] {
    let ops = [...this.operations];
    if (filter?.assetCode) ops = ops.filter((o) => o.assetCode === filter.assetCode);
    if (filter?.holder) ops = ops.filter((o) => o.from === filter.holder || o.to === filter.holder);
    return ops.sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Get asset info. */
  getAsset(assetCode: string): TwinTokenAsset | undefined { return this.assets.get(assetCode); }
  allAssets(): TwinTokenAsset[] { return [...this.assets.values()]; }

  reset(): void {
    this.assets.clear(); this.balances.clear(); this.operations = []; this.frozenAccounts.clear();
  }

  private creditBalance(holder: string, assetCode: string, amount: number): void {
    const bal = this.getOrCreateBalance(holder, assetCode);
    bal.balance = round(bal.balance + amount, 6);
    bal.available = round(bal.balance - bal.escrowed - bal.frozen, 6);
  }

  private debitBalance(holder: string, assetCode: string, amount: number): void {
    const bal = this.getOrCreateBalance(holder, assetCode);
    bal.balance = round(bal.balance - amount, 6);
    bal.available = round(bal.balance - bal.escrowed - bal.frozen, 6);
  }

  private getOrCreateBalance(holder: string, assetCode: string): TwinTokenBalance {
    const key = `${holder}:${assetCode}`;
    let bal = this.balances.get(key);
    if (!bal) {
      bal = { holder, assetCode, balance: 0, escrowed: 0, frozen: 0, available: 0 };
      this.balances.set(key, bal);
    }
    return bal;
  }
}

export const twinTokenEngine = new TwinTokenEngine();
