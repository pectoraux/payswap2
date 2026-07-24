/**
 * PaySwap Protocol — Wallet System.
 *
 * Separation:
 *   PaySwap Account → user identity in the system
 *   Wallet → balances, preferences, aliases, QR codes, transaction history
 *   Blockchain Account → chain-specific accounts (Stellar, Ethereum, etc.)
 *
 * Wallet balances are PROJECTIONS rebuilt from events.
 * Never mutate balances directly.
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';

export type AccountType = 'individual' | 'merchant' | 'lp';

export interface PaySwapAccount {
  id: string;
  type: AccountType;
  name: string;
  email: string;
  phone: string;
  country: string;
  kycLevel: number;
  createdAt: number;
  wallets: string[];
  blockchainAccounts: string[];
}

export interface Wallet {
  id: string;
  accountId: string;
  name: string;
  currency: string;
  alias: string;
  balance: number;
  pendingBalance: number;
  lockedBalance: number;
  createdAt: number;
  isDefault: boolean;
}

export interface BlockchainAccount {
  id: string;
  accountId: string;
  chain: string;
  address: string;
  createdAt: number;
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  type: 'credit' | 'debit' | 'lock' | 'unlock';
  amount: number;
  currency: string;
  counterparty: string;
  reference: string;
  ts: number;
}

export class WalletService {
  private accounts: Map<string, PaySwapAccount> = new Map();
  private wallets: Map<string, Wallet> = new Map();
  private blockchainAccounts: Map<string, BlockchainAccount> = new Map();
  private transactions: WalletTransaction[] = [];

  /** Create a PaySwap account. */
  createAccount(params: {
    type: AccountType; name: string; email: string; phone: string; country: string;
  }): PaySwapAccount {
    const account: PaySwapAccount = {
      id: uid('account'),
      type: params.type, name: params.name, email: params.email, phone: params.phone,
      country: params.country, kycLevel: 0, createdAt: Date.now(),
      wallets: [], blockchainAccounts: [],
    };
    this.accounts.set(account.id, account);
    eventEngine.emit('wallet.account_created', { accountId: account.id, type: params.type, name: params.name }, 0);
    return account;
  }

  /** Create a wallet for an account. */
  createWallet(accountId: string, currency: string, name?: string): Wallet | null {
    const account = this.accounts.get(accountId);
    if (!account) return null;

    const wallet: Wallet = {
      id: uid('wallet'),
      accountId,
      name: name ?? `${currency} Wallet`,
      currency,
      alias: this.generateAlias(),
      balance: 0, pendingBalance: 0, lockedBalance: 0,
      createdAt: Date.now(),
      isDefault: account.wallets.length === 0,
    };
    this.wallets.set(wallet.id, wallet);
    account.wallets.push(wallet.id);
    eventEngine.emit('wallet.created', { walletId: wallet.id, accountId, currency }, 0);
    return wallet;
  }

  /** Link a blockchain account. */
  linkBlockchainAccount(accountId: string, chain: string, address: string): BlockchainAccount | null {
    const account = this.accounts.get(accountId);
    if (!account) return null;

    const bc: BlockchainAccount = {
      id: uid('bc'), accountId, chain, address, createdAt: Date.now(),
    };
    this.blockchainAccounts.set(bc.id, bc);
    account.blockchainAccounts.push(bc.id);
    eventEngine.emit('wallet.blockchain_linked', { accountId, chain, address }, 0);
    return bc;
  }

  /** Credit wallet (from settlement). Produces event — balance is a projection. */
  credit(walletId: string, amount: number, counterparty: string, reference: string): Wallet | null {
    const wallet = this.wallets.get(walletId);
    if (!wallet) return null;
    wallet.balance = round(wallet.balance + amount, 6);
    this.transactions.push({
      id: uid('tx'), walletId, type: 'credit', amount, currency: wallet.currency,
      counterparty, reference, ts: Date.now(),
    });
    eventEngine.emit('wallet.credited', { walletId, amount, currency: wallet.currency, counterparty, reference }, 0);
    return wallet;
  }

  /** Debit wallet (for payment). Produces event. */
  debit(walletId: string, amount: number, counterparty: string, reference: string): Wallet | null {
    const wallet = this.wallets.get(walletId);
    if (!wallet || wallet.balance < amount) return null;
    wallet.balance = round(wallet.balance - amount, 6);
    this.transactions.push({
      id: uid('tx'), walletId, type: 'debit', amount, currency: wallet.currency,
      counterparty, reference, ts: Date.now(),
    });
    eventEngine.emit('wallet.debited', { walletId, amount, currency: wallet.currency, counterparty, reference }, 0);
    return wallet;
  }

  /** Lock funds (for pending settlement). */
  lock(walletId: string, amount: number, reference: string): Wallet | null {
    const wallet = this.wallets.get(walletId);
    if (!wallet || wallet.balance < amount) return null;
    wallet.balance = round(wallet.balance - amount, 6);
    wallet.lockedBalance = round(wallet.lockedBalance + amount, 6);
    this.transactions.push({
      id: uid('tx'), walletId, type: 'lock', amount, currency: wallet.currency,
      counterparty: 'escrow', reference, ts: Date.now(),
    });
    eventEngine.emit('wallet.locked', { walletId, amount, reference }, 0);
    return wallet;
  }

  /** Unlock funds (settlement failed/cancelled). */
  unlock(walletId: string, amount: number, reference: string): Wallet | null {
    const wallet = this.wallets.get(walletId);
    if (!wallet || wallet.lockedBalance < amount) return null;
    wallet.lockedBalance = round(wallet.lockedBalance - amount, 6);
    wallet.balance = round(wallet.balance + amount, 6);
    this.transactions.push({
      id: uid('tx'), walletId, type: 'unlock', amount, currency: wallet.currency,
      counterparty: 'escrow', reference, ts: Date.now(),
    });
    eventEngine.emit('wallet.unlocked', { walletId, amount, reference }, 0);
    return wallet;
  }

  /** Get wallet by ID. */
  getWallet(walletId: string): Wallet | undefined { return this.wallets.get(walletId); }

  /** Get all wallets for an account. */
  getWalletsByAccount(accountId: string): Wallet[] {
    return this.accounts.get(accountId)?.wallets.map((id) => this.wallets.get(id)).filter((w): w is Wallet => !!w) ?? [];
  }

  /** Get account. */
  getAccount(accountId: string): PaySwapAccount | undefined { return this.accounts.get(accountId); }

  /** Get blockchain accounts for an account. */
  getBlockchainAccounts(accountId: string): BlockchainAccount[] {
    return this.accounts.get(accountId)?.blockchainAccounts.map((id) => this.blockchainAccounts.get(id)).filter((b): b is BlockchainAccount => !!b) ?? [];
  }

  /** Get transaction history for a wallet. */
  getTransactions(walletId: string): WalletTransaction[] {
    return this.transactions.filter((t) => t.walletId === walletId).sort((a, b) => b.ts - a.ts);
  }

  /** Rebuild wallet balances from events (projection). */
  rebuildBalancesFromEvents(events: { type: string; payload: Record<string, unknown> }[]): void {
    for (const wallet of this.wallets.values()) {
      wallet.balance = 0; wallet.lockedBalance = 0; wallet.pendingBalance = 0;
    }
    for (const evt of events) {
      if (evt.type === 'wallet.credited') {
        const w = this.wallets.get(evt.payload.walletId as string);
        if (w) w.balance = round(w.balance + (evt.payload.amount as number), 6);
      } else if (evt.type === 'wallet.debited') {
        const w = this.wallets.get(evt.payload.walletId as string);
        if (w) w.balance = round(w.balance - (evt.payload.amount as number), 6);
      } else if (evt.type === 'wallet.locked') {
        const w = this.wallets.get(evt.payload.walletId as string);
        if (w) { w.balance = round(w.balance - (evt.payload.amount as number), 6); w.lockedBalance = round(w.lockedBalance + (evt.payload.amount as number), 6); }
      } else if (evt.type === 'wallet.unlocked') {
        const w = this.wallets.get(evt.payload.walletId as string);
        if (w) { w.lockedBalance = round(w.lockedBalance - (evt.payload.amount as number), 6); w.balance = round(w.balance + (evt.payload.amount as number), 6); }
      }
    }
  }

  private generateAlias(): string {
    return `psw_${uid('').slice(-8)}`;
  }

  reset(): void {
    this.accounts.clear(); this.wallets.clear(); this.blockchainAccounts.clear(); this.transactions = [];
  }
}

export const walletService = new WalletService();
