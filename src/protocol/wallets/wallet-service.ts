/**
 * PaySwap Protocol — Wallet Service.
 *
 * The PaySwap wallet layer sits above the kernel + blockchain adapters. It
 * maintains fiat-style account balances (off-chain, ledger-style) and links
 * to on-chain accounts for settlement.
 *
 * Lifecycle:
 *   createAccount() → createWallet() per currency → credit/debit/lock/unlock
 *
 * Locking is the settlement subsystem's interface: when settlement escrow
 * freezes a balance, the wallet `lock()` mirrors that lock locally so debit()
 * cannot drain funds that are committed to an in-flight settlement. Once
 * settlement completes, the lock is either:
 *   - unlocked()  (settlement failed/refunded — funds return to available)
 *   - debited()   (settlement succeeded — funds leave the wallet)
 *
 * `rebuildBalancesFromEvents()` is the projection used by the persistence
 * layer to reconstruct wallet state from the kernel event stream.
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';

export type AccountType = 'personal' | 'business' | 'merchant' | 'lp' | 'treasury' | 'operational';

export interface PaySwapAccount {
  id: string;
  type: AccountType;
  name: string;
  email?: string;
  phone?: string;
  country: string;
  createdAt: number;
  blockchainAccounts: BlockchainAccount[];
}

export interface Wallet {
  id: string;
  accountId: string;
  currency: string;
  name: string;
  balance: number;
  locked: number;
  createdAt: number;
}

export interface BlockchainAccount {
  id: string;
  accountId: string;
  chain: string;
  address: string;
  linkedAt: number;
}

export type WalletTransactionType = 'credit' | 'debit' | 'lock' | 'unlock';

export interface WalletTransaction {
  id: string;
  walletId: string;
  type: WalletTransactionType;
  amount: number;
  counterparty: string;
  reference: string;
  ts: number;
  balanceAfter: number;
  lockedAfter: number;
}

export interface WalletEventLike {
  type: string;
  payload: Record<string, unknown>;
}

export class WalletService {
  private accounts = new Map<string, PaySwapAccount>();
  private wallets = new Map<string, Wallet>();
  private blockchainAccounts = new Map<string, BlockchainAccount>();
  private transactions: WalletTransaction[] = [];

  // ------------------------------------------------------------- createAccount
  createAccount(params: { type: AccountType; name: string; email?: string; phone?: string; country: string }): PaySwapAccount {
    const id = uid('acct');
    const account: PaySwapAccount = {
      id,
      type: params.type,
      name: params.name,
      email: params.email,
      phone: params.phone,
      country: params.country,
      createdAt: Date.now(),
      blockchainAccounts: [],
    };
    this.accounts.set(id, account);
    eventEngine.emit('wallet.account_created', {
      accountId: id,
      type: params.type,
      name: params.name,
      country: params.country,
    }, 0);
    return account;
  }

  // ---------------------------------------------------------------- createWallet
  createWallet(accountId: string, currency: string, name?: string): Wallet {
    if (!this.accounts.has(accountId)) throw new Error(`account ${accountId} not found`);
    const id = uid('wallet');
    const wallet: Wallet = {
      id,
      accountId,
      currency,
      name: name ?? `${currency} wallet`,
      balance: 0,
      locked: 0,
      createdAt: Date.now(),
    };
    this.wallets.set(id, wallet);
    eventEngine.emit('wallet.created', {
      walletId: id,
      accountId,
      currency,
      name: wallet.name,
    }, 0);
    return wallet;
  }

  // ------------------------------------------------------- linkBlockchainAccount
  linkBlockchainAccount(accountId: string, chain: string, address: string): BlockchainAccount {
    if (!this.accounts.has(accountId)) throw new Error(`account ${accountId} not found`);
    const id = uid('bcacct');
    const bc: BlockchainAccount = {
      id, accountId, chain, address, linkedAt: Date.now(),
    };
    this.blockchainAccounts.set(id, bc);
    const acct = this.accounts.get(accountId);
    if (acct) acct.blockchainAccounts.push(bc);
    eventEngine.emit('wallet.blockchain_linked', {
      accountId, chain, address, blockchainAccountId: id,
    }, 0);
    return bc;
  }

  // -------------------------------------------------------------------- credit
  credit(walletId: string, amount: number, counterparty: string, reference: string): WalletTransaction {
    if (amount <= 0) throw new Error('amount must be positive');
    const w = this.requireWallet(walletId);
    w.balance = round(w.balance + amount, 6);
    return this.recordTx(w, 'credit', amount, counterparty, reference);
  }

  // -------------------------------------------------------------------- debit
  debit(walletId: string, amount: number, counterparty: string, reference: string): WalletTransaction {
    if (amount <= 0) throw new Error('amount must be positive');
    const w = this.requireWallet(walletId);
    const available = w.balance - w.locked;
    if (available < amount) throw new Error(`insufficient available balance in wallet ${walletId} (have ${available}, need ${amount})`);
    w.balance = round(w.balance - amount, 6);
    return this.recordTx(w, 'debit', amount, counterparty, reference);
  }

  // ---------------------------------------------------------------------- lock
  /** Lock funds for an in-flight settlement. Locked funds cannot be debited. */
  lock(walletId: string, amount: number, reference: string): WalletTransaction {
    if (amount <= 0) throw new Error('amount must be positive');
    const w = this.requireWallet(walletId);
    const available = w.balance - w.locked;
    if (available < amount) throw new Error(`insufficient available balance to lock in wallet ${walletId} (have ${available}, need ${amount})`);
    w.locked = round(w.locked + amount, 6);
    return this.recordTx(w, 'lock', amount, 'escrow', reference);
  }

  // -------------------------------------------------------------------- unlock
  unlock(walletId: string, amount: number, reference: string): WalletTransaction {
    if (amount <= 0) throw new Error('amount must be positive');
    const w = this.requireWallet(walletId);
    if (w.locked < amount) throw new Error(`insufficient locked balance in wallet ${walletId} (locked ${w.locked}, need ${amount})`);
    w.locked = round(w.locked - amount, 6);
    return this.recordTx(w, 'unlock', amount, 'escrow', reference);
  }

  // ------------------------------------------------------------------ queries
  getWallet(walletId: string): Wallet | undefined { return this.wallets.get(walletId); }

  getWalletsByAccount(accountId: string): Wallet[] {
    return [...this.wallets.values()].filter((w) => w.accountId === accountId);
  }

  getAccount(accountId: string): PaySwapAccount | undefined { return this.accounts.get(accountId); }

  getBlockchainAccounts(accountId: string): BlockchainAccount[] {
    return [...this.blockchainAccounts.values()].filter((b) => b.accountId === accountId);
  }

  getTransactions(walletId: string): WalletTransaction[] {
    return this.transactions.filter((t) => t.walletId === walletId);
  }

  allAccounts(): PaySwapAccount[] { return [...this.accounts.values()]; }
  allWallets(): Wallet[] { return [...this.wallets.values()]; }
  allTransactions(): WalletTransaction[] { return [...this.transactions]; }

  // ----------------------------------------------- rebuildBalancesFromEvents
  /**
   * Projection: rebuild all wallet balances/locks from a kernel event stream.
   * Used by the persistence layer to reconstruct state from the event log.
   * Wallets and accounts must already exist (created via createAccount/​createWallet
   * — those events are idempotent and replayed first by the projector).
   */
  rebuildBalancesFromEvents(events: WalletEventLike[]): void {
    // Reset monetary state — events will rebuild it.
    for (const w of this.wallets.values()) {
      w.balance = 0;
      w.locked = 0;
    }
    for (const e of events) {
      const p = e.payload;
      const walletId = p.walletId as string | undefined;
      if (!walletId) continue;
      const w = this.wallets.get(walletId);
      if (!w) continue;
      const amount = (p.amount as number) ?? 0;
      switch (e.type) {
        case 'wallet.credited':
          w.balance = round(w.balance + amount, 6);
          break;
        case 'wallet.debited':
          w.balance = round(w.balance - amount, 6);
          break;
        case 'wallet.locked':
          w.locked = round(w.locked + amount, 6);
          break;
        case 'wallet.unlocked':
          w.locked = round(w.locked - amount, 6);
          break;
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------------ helpers
  private requireWallet(walletId: string): Wallet {
    const w = this.wallets.get(walletId);
    if (!w) throw new Error(`wallet ${walletId} not found`);
    return w;
  }

  private recordTx(w: Wallet, type: WalletTransactionType, amount: number, counterparty: string, reference: string): WalletTransaction {
    const tx: WalletTransaction = {
      id: uid('wtx'),
      walletId: w.id,
      type,
      amount,
      counterparty,
      reference,
      ts: Date.now(),
      balanceAfter: w.balance,
      lockedAfter: w.locked,
    };
    this.transactions.push(tx);
    switch (type) {
      case 'credit':
        eventEngine.emit('wallet.credited', { walletId: w.id, accountId: w.accountId, amount, counterparty, reference, balance: w.balance }, 0);
        break;
      case 'debit':
        eventEngine.emit('wallet.debited', { walletId: w.id, accountId: w.accountId, amount, counterparty, reference, balance: w.balance }, 0);
        break;
      case 'lock':
        eventEngine.emit('wallet.locked', { walletId: w.id, accountId: w.accountId, amount, reference, locked: w.locked }, 0);
        break;
      case 'unlock':
        eventEngine.emit('wallet.unlocked', { walletId: w.id, accountId: w.accountId, amount, reference, locked: w.locked }, 0);
        break;
    }
    return tx;
  }
}

export const walletService = new WalletService();
