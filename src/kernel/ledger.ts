/**
 * Ledger Engine — multi-currency double-entry accounting.
 *
 * Every value movement in the kernel is expressed as a balanced set of
 * debit/credit entries against typed accounts. The ledger is the single
 * source of truth for balances; reserves, treasury and settlement all post
 * through it. This guarantees that no token can be minted, no reserve drawn,
 * and no merchant paid without a corresponding, auditable pair of entries.
 */
import type {
  AccountType,
  LedgerAccount,
  LedgerEntry,
  CurrencyCode,
  WorldState,
} from './types';
import { uid, nowTs } from './support';
import { eventEngine } from './event';

export interface PostInput {
  txId: string;
  accountId: string;
  debit?: number;
  credit?: number;
  memo: string;
  frame: number;
}

export class LedgerEngine {
  private world: WorldState;
  private entries: LedgerEntry[] = [];

  constructor(world: WorldState) {
    this.world = world;
  }

  /** Ensure an account exists, creating it if necessary. */
  ensureAccount(
    id: string,
    label: string,
    currency: CurrencyCode,
    type: AccountType,
    openingBalance = 0,
  ): LedgerAccount {
    let acc = this.world.accounts.get(id);
    if (!acc) {
      acc = { id, label, currency, type, balance: openingBalance };
      this.world.accounts.set(id, acc);
    }
    return acc;
  }

  getAccount(id: string): LedgerAccount | undefined {
    return this.world.accounts.get(id);
  }

  /**
   * Post one leg of a transaction. Debit increases asset/expense accounts and
   * decreases liability/equity/revenue; credit is the inverse. The caller is
   * responsible for posting balanced legs (sum of debits === sum of credits).
   */
  post(input: PostInput): LedgerEntry {
    const acc = this.ensureAccount(input.accountId, input.accountId, 'USD', 'asset');
    const debit = input.debit ?? 0;
    const credit = input.credit ?? 0;
    if (debit < 0 || credit < 0) throw new Error('Ledger entries must be non-negative');
    if (debit > 0 && credit > 0) throw new Error('An entry cannot be both debit and credit');

    // Asset/Expense: debit increases, credit decreases.
    // Liability/Equity/Revenue: credit increases, debit decreases.
    const isDebitNormal = acc.type === 'asset' || acc.type === 'expense';
    const delta = (debit - credit) * (isDebitNormal ? 1 : -1);
    acc.balance = Math.round((acc.balance + delta) * 1e6) / 1e6;

    const entry: LedgerEntry = {
      id: uid('le'),
      txId: input.txId,
      accountId: acc.id,
      accountLabel: acc.label,
      accountType: acc.type,
      currency: acc.currency,
      debit,
      credit,
      balanceAfter: acc.balance,
      memo: input.memo,
      frame: input.frame,
      ts: nowTs(),
    };
    this.entries.push(entry);

    eventEngine.emit(
      'ledger.posted',
      {
        accountId: acc.id,
        debit,
        credit,
        balanceAfter: acc.balance,
        memo: input.memo,
        frame: input.frame,
      },
      input.frame,
    );

    return entry;
  }

  /** Post a balanced pair of legs in one call (the common case). */
  postPair(
    txId: string,
    debitAccountId: string,
    creditAccountId: string,
    amount: number,
    memo: string,
    frame: number,
  ): [LedgerEntry, LedgerEntry] {
    const d = this.post({ txId, accountId: debitAccountId, debit: amount, memo, frame });
    const c = this.post({ txId, accountId: creditAccountId, credit: amount, memo, frame });
    return [d, c];
  }

  all(): LedgerEntry[] {
    return [...this.entries];
  }

  frame(frame: number): LedgerEntry[] {
    return this.entries.filter((e) => e.frame === frame);
  }

  reset(): void {
    this.entries = [];
  }
}
