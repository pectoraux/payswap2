/**
 * PaySwap Protocol — Custodial Wallet Service.
 *
 * Custodial wallets: PaySwap holds the encrypted seed and signs on the
 * customer's behalf. The customer interacts with their funds through
 * PaySwap's API; PaySwap enforces policy gates (withdrawal approval,
 * spending limits, MFA) before signing.
 *
 * Under the hood, custodial wallets use HD derivation via
 * `hdWalletService.createHDWallet()`. The mnemonic is encrypted with
 * the PaySwap master key and stored in `encryptedKeyStore`.
 *
 * Lifecycle:
 *   createCustodialWallet() → activate → ... → freeze/unfreeze → close
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `wallet.custodial_created`
 *  - `wallet.custodial_activated`
 *  - `wallet.custodial_frozen`
 *  - `wallet.custodial_unfrozen`
 *  - `wallet.custodial_closed`
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and uses
 * `hdWalletService` + `WalletError`.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { hdWalletService } from './hd-wallet';
import { EncryptedKeyStore } from './encrypted-storage';
import {
  WalletError,
  type HDWallet,
  type WalletState,
} from './types';

/** Per-wallet balance record (off-chain, ledger-style). */
export interface CustodialBalance {
  walletId: string;
  /** Map of asset code → amount. */
  balances: Record<string, number>;
  /** Total locked across all assets (escrowed for in-flight settlements). */
  locked: Record<string, number>;
  updatedAt: number;
}

/** Custodial wallet record (HD wallet + balance + audit metadata). */
export interface CustodialWalletRecord {
  wallet: HDWallet;
  balance: CustodialBalance;
  frozenReason?: string;
  frozenAt?: number;
  closedAt?: number;
  closedReason?: string;
}

export class CustodialWalletService {
  private records = new Map<string, CustodialWalletRecord>();
  /** accountId → walletIds[] index. */
  private byAccount = new Map<string, string[]>();

  // ------------------------------------------------- createCustodialWallet
  /**
   * Create a new custodial wallet. PaySwap generates the HD seed,
   * encrypts it with the master key, and stores it. The wallet starts
   * in `pending_activation` state — call `activateWallet()` once KYC
   * is complete.
   */
  createCustodialWallet(
    accountId: string,
    chain: string,
    opts?: { derivationPath?: string; masterKey?: string },
  ): CustodialWalletRecord {
    const masterKey = opts?.masterKey ?? EncryptedKeyStore.loadMasterSecret();
    const created = hdWalletService.createHDWallet(accountId, chain, {
      type: 'custodial',
      state: 'pending_activation',
      derivationPath: opts?.derivationPath,
      masterKey,
    });
    const wallet = created.wallet;

    const record: CustodialWalletRecord = {
      wallet,
      balance: {
        walletId: wallet.id,
        balances: {},
        locked: {},
        updatedAt: nowTs(),
      },
    };
    this.records.set(wallet.id, record);

    // Index by account.
    const list = this.byAccount.get(accountId) ?? [];
    list.push(wallet.id);
    this.byAccount.set(accountId, list);

    eventEngine.emit('wallet.custodial_created', {
      walletId: wallet.id,
      accountId,
      chain,
      address: wallet.address,
    });
    return record;
  }

  // ------------------------------------------------- activateWallet
  /** Move a wallet from `pending_activation` → `active`. */
  activateWallet(walletId: string): CustodialWalletRecord {
    const record = this.requireWallet(walletId);
    if (record.wallet.state !== 'pending_activation') {
      throw new WalletError(
        'custodial.bad_state',
        `Wallet ${walletId} is in state ${record.wallet.state} — cannot activate`,
        { walletId, state: record.wallet.state },
      );
    }
    hdWalletService.setState(walletId, 'active');
    eventEngine.emit('wallet.custodial_activated', { walletId });
    return record;
  }

  // ------------------------------------------------- freezeWallet / unfreeze
  /** Freeze a wallet (compliance hold / suspected compromise). */
  freezeWallet(walletId: string, reason: string): CustodialWalletRecord {
    const record = this.requireWallet(walletId);
    if (record.wallet.state === 'closed') {
      throw new WalletError('custodial.closed', `Wallet ${walletId} is closed`);
    }
    hdWalletService.setState(walletId, 'frozen');
    record.frozenReason = reason;
    record.frozenAt = nowTs();
    eventEngine.emit('wallet.custodial_frozen', { walletId, reason });
    return record;
  }

  /** Unfreeze a previously-frozen wallet. */
  unfreezeWallet(walletId: string): CustodialWalletRecord {
    const record = this.requireWallet(walletId);
    if (record.wallet.state !== 'frozen') {
      throw new WalletError(
        'custodial.not_frozen',
        `Wallet ${walletId} is not frozen (state: ${record.wallet.state})`,
      );
    }
    hdWalletService.setState(walletId, 'active');
    record.frozenReason = undefined;
    record.frozenAt = undefined;
    eventEngine.emit('wallet.custodial_unfrozen', { walletId });
    return record;
  }

  // ------------------------------------------------- closeWallet
  /**
   * Permanently close a wallet. Funds MUST be swept out first (the
   * service verifies all balances are zero). The encrypted seed is
   * securely deleted.
   */
  closeWallet(walletId: string, reason: string): CustodialWalletRecord {
    const record = this.requireWallet(walletId);

    // Verify all balances are zero.
    const nonZero = Object.entries(record.balance.balances).filter(([, v]) => v > 0);
    if (nonZero.length > 0) {
      throw new WalletError(
        'custodial.balance_outstanding',
        `Cannot close wallet ${walletId} — outstanding balances: ${nonZero.map(([k, v]) => `${k}=${v}`).join(', ')}`,
        { walletId, balances: record.balance.balances },
      );
    }

    hdWalletService.setState(walletId, 'closed');
    record.closedAt = nowTs();
    record.closedReason = reason;

    // Securely delete the encrypted seed.
    hdWalletService.removeWallet(walletId);

    eventEngine.emit('wallet.custodial_closed', { walletId, reason });
    return record;
  }

  // ------------------------------------------------- getWallet / getWalletsByAccount
  getWallet(walletId: string): CustodialWalletRecord | undefined {
    return this.records.get(walletId);
  }

  getWalletsByAccount(accountId: string): CustodialWalletRecord[] {
    const ids = this.byAccount.get(accountId) ?? [];
    return ids
      .map((id) => this.records.get(id))
      .filter((r): r is CustodialWalletRecord => r !== undefined);
  }

  // ------------------------------------------------- getBalance / getBalances
  /** Get the balance map for a single wallet. */
  getBalance(walletId: string): CustodialBalance {
    const record = this.requireWallet(walletId);
    return record.balance;
  }

  /** Aggregate balances across all of an account's wallets. */
  getBalances(accountId: string): Record<string, number> {
    const wallets = this.getWalletsByAccount(accountId);
    const out: Record<string, number> = {};
    for (const w of wallets) {
      for (const [asset, amount] of Object.entries(w.balance.balances)) {
        out[asset] = (out[asset] ?? 0) + amount;
      }
    }
    return out;
  }

  // ------------------------------------------------- credit / debit (internal)
  /**
   * Credit a wallet balance (e.g. after a deposit settles). Internal —
   * external callers go through the settlement layer.
   */
  credit(walletId: string, asset: string, amount: number): CustodialBalance {
    if (amount <= 0) throw new WalletError('custodial.bad_amount', 'amount must be positive');
    const record = this.requireWallet(walletId);
    if (record.wallet.state !== 'active') {
      throw new WalletError(
        'custodial.not_active',
        `Wallet ${walletId} is in state ${record.wallet.state}`,
      );
    }
    record.balance.balances[asset] = (record.balance.balances[asset] ?? 0) + amount;
    record.balance.updatedAt = nowTs();
    eventEngine.emit('wallet.custodial_credited', { walletId, asset, amount });
    return record.balance;
  }

  /** Debit a wallet balance (e.g. after a withdrawal executes). Internal. */
  debit(walletId: string, asset: string, amount: number): CustodialBalance {
    if (amount <= 0) throw new WalletError('custodial.bad_amount', 'amount must be positive');
    const record = this.requireWallet(walletId);
    if (record.wallet.state !== 'active') {
      throw new WalletError(
        'custodial.not_active',
        `Wallet ${walletId} is in state ${record.wallet.state}`,
      );
    }
    const available = (record.balance.balances[asset] ?? 0) - (record.balance.locked[asset] ?? 0);
    if (available < amount) {
      throw new WalletError(
        'custodial.insufficient_balance',
        `Insufficient ${asset} balance in wallet ${walletId} (have ${available}, need ${amount})`,
        { walletId, asset, available, required: amount },
      );
    }
    record.balance.balances[asset] = (record.balance.balances[asset] ?? 0) - amount;
    record.balance.updatedAt = nowTs();
    eventEngine.emit('wallet.custodial_debited', { walletId, asset, amount });
    return record.balance;
  }

  /** Lock funds for an in-flight settlement. */
  lock(walletId: string, asset: string, amount: number): CustodialBalance {
    if (amount <= 0) throw new WalletError('custodial.bad_amount', 'amount must be positive');
    const record = this.requireWallet(walletId);
    const available = (record.balance.balances[asset] ?? 0) - (record.balance.locked[asset] ?? 0);
    if (available < amount) {
      throw new WalletError('custodial.insufficient_balance', `Insufficient ${asset} to lock`);
    }
    record.balance.locked[asset] = (record.balance.locked[asset] ?? 0) + amount;
    record.balance.updatedAt = nowTs();
    eventEngine.emit('wallet.custodial_locked', { walletId, asset, amount });
    return record.balance;
  }

  /** Unlock previously-locked funds. */
  unlock(walletId: string, asset: string, amount: number): CustodialBalance {
    if (amount <= 0) throw new WalletError('custodial.bad_amount', 'amount must be positive');
    const record = this.requireWallet(walletId);
    if ((record.balance.locked[asset] ?? 0) < amount) {
      throw new WalletError('custodial.insufficient_locked', `Insufficient locked ${asset}`);
    }
    record.balance.locked[asset] = (record.balance.locked[asset] ?? 0) - amount;
    record.balance.updatedAt = nowTs();
    eventEngine.emit('wallet.custodial_unlocked', { walletId, asset, amount });
    return record.balance;
  }

  // ------------------------------------------------- helpers
  private requireWallet(walletId: string): CustodialWalletRecord {
    const record = this.records.get(walletId);
    if (!record) {
      throw new WalletError('custodial.not_found', `Custodial wallet ${walletId} not found`, { walletId });
    }
    return record;
  }

  /** Require the wallet to be in `active` state (signing allowed). */
  requireActive(walletId: string): CustodialWalletRecord {
    const record = this.requireWallet(walletId);
    if (record.wallet.state !== 'active') {
      throw new WalletError(
        'custodial.not_active',
        `Wallet ${walletId} is in state ${record.wallet.state}`,
        { walletId, state: record.wallet.state },
      );
    }
    return record;
  }

  /** Get the WalletState for a wallet. */
  getState(walletId: string): WalletState | undefined {
    return this.records.get(walletId)?.wallet.state;
  }

  /** Number of active custodial wallets. */
  count(): number {
    return this.records.size;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForCustodial = globalThis as unknown as { __PAYSWAP_CUSTODIAL_WALLET_SERVICE?: CustodialWalletService };
export const custodialWalletService =
  _globalForCustodial.__PAYSWAP_CUSTODIAL_WALLET_SERVICE ?? new CustodialWalletService();
if (!_globalForCustodial.__PAYSWAP_CUSTODIAL_WALLET_SERVICE) {
  _globalForCustodial.__PAYSWAP_CUSTODIAL_WALLET_SERVICE = custodialWalletService;
}
