/**
 * PaySwap Protocol — Double-Entry Ledger / Chart of Accounts.
 * -----------------------------------------------------------------------------
 * The standard 5-type chart of accounts for PaySwap:
 *   - Asset       (cash, twin tokens in circulation/escrow, settlement claims, LP collateral, stellar reserves)
 *   - Liability   (user wallet balances, merchant payables, pending payouts, twin token backing)
 *   - Equity      (protocol equity, fees equity, treasury)
 *   - Revenue     (fees by method, fx)
 *   - Expense     (connector costs, on-chain costs)
 *
 * Account codes are hierarchical strings: `category:subcategory[:identifier]`.
 * Examples:
 *   `cash:bank:GHS`               — bank cash in GHS
 *   `cash:mmo:KES`                — mobile-money-operator cash in KES
 *   `twintoken:circulating:TWINGHS` — Twin Tokens currently in circulation
 *   `twin:backing:GHS`            — liability to redeem TWINGHS for GHS
 *   `user:wallet:wallet_abc`      — liability owed to a wallet holder
 *   `merchant:payable:merchant_xyz` — liability owed to a merchant
 *   `revenue:fees:bank`           — fee revenue collected from bank payouts
 *
 * This module is pure data — no kernel mutations. It defines the standard
 * set, plus a lookup helper for ad-hoc codes (per-currency, per-merchant).
 */
import type { CurrencyCode } from '@/kernel/types';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type NormalBalance = 'debit' | 'credit';

export interface LedgerAccount {
  /** Hierarchical code, e.g. `cash:bank:GHS`. */
  code: string;
  /** Human-readable label. */
  name: string;
  /** Accounting type — drives which financial statement this appears on. */
  type: AccountType;
  /** Which side increases the account: assets/expenses → debit; liabilities/equity/revenue → credit. */
  normalBalance: NormalBalance;
  /** Currency code if the account is single-currency; undefined for multi-currency rollups. */
  currency?: string;
}

/**
 * Standard template accounts — concrete instances are typically created with
 * `getAccount(code)` for parameterized codes (per currency / per merchant).
 */
export const CHART_OF_ACCOUNTS: LedgerAccount[] = [
  // ─── Assets ────────────────────────────────────────────────────────────
  { code: 'cash:bank', name: 'Cash — Bank', type: 'asset', normalBalance: 'debit' },
  { code: 'cash:mmo', name: 'Cash — Mobile Money Operator', type: 'asset', normalBalance: 'debit' },
  { code: 'twintoken:circulating', name: 'Twin Tokens — Circulating', type: 'asset', normalBalance: 'debit' },
  { code: 'twintoken:escrowed', name: 'Twin Tokens — Escrowed', type: 'asset', normalBalance: 'debit' },
  { code: 'settlement:receivable', name: 'Settlement — Receivable (locked funds)', type: 'asset', normalBalance: 'debit' },
  { code: 'lp:collateral', name: 'LP / Merchant Collateral', type: 'asset', normalBalance: 'debit' },
  { code: 'reserve:stellar', name: 'Reserve — Stellar (XLM)', type: 'asset', normalBalance: 'debit' },

  // ─── Liabilities ──────────────────────────────────────────────────────
  { code: 'user:wallet', name: 'User Wallet Balance (payable)', type: 'liability', normalBalance: 'credit' },
  { code: 'merchant:payable', name: 'Merchant Payable', type: 'liability', normalBalance: 'credit' },
  { code: 'payout:pending', name: 'Pending Payouts', type: 'liability', normalBalance: 'credit' },
  { code: 'twin:backing', name: 'Twin Token Backing Liability (redeemable)', type: 'liability', normalBalance: 'credit' },

  // ─── Equity ───────────────────────────────────────────────────────────
  { code: 'equity:protocol', name: 'Protocol Equity', type: 'equity', normalBalance: 'credit' },
  { code: 'equity:fees', name: 'Fees Equity (unrecognized)', type: 'equity', normalBalance: 'credit' },
  { code: 'equity:treasury', name: 'Treasury Equity (bonds + retained fees)', type: 'equity', normalBalance: 'credit' },

  // ─── Revenue ──────────────────────────────────────────────────────────
  { code: 'revenue:fees', name: 'Fee Revenue (by method)', type: 'revenue', normalBalance: 'credit' },
  { code: 'revenue:fx', name: 'FX Revenue', type: 'revenue', normalBalance: 'credit' },

  // ─── Expenses ─────────────────────────────────────────────────────────
  { code: 'expense:connector', name: 'Connector Expenses', type: 'expense', normalBalance: 'debit' },
  { code: 'expense:chain', name: 'On-Chain Expenses', type: 'expense', normalBalance: 'debit' },
];

/** Quick lookup of standard template accounts by their prefix. */
const STANDARD_BY_CODE: Map<string, LedgerAccount> = new Map(
  CHART_OF_ACCOUNTS.map((a) => [a.code, a]),
);

/** Known parameterized-account prefixes (in order of specificity). */
const PARAMETERIZED_PREFIXES: Array<{ prefix: string; template: LedgerAccount }> = [
  { prefix: 'cash:bank:', template: STANDARD_BY_CODE.get('cash:bank')! },
  { prefix: 'cash:mmo:', template: STANDARD_BY_CODE.get('cash:mmo')! },
  { prefix: 'twintoken:circulating:', template: STANDARD_BY_CODE.get('twintoken:circulating')! },
  { prefix: 'twintoken:escrowed:', template: STANDARD_BY_CODE.get('twintoken:escrowed')! },
  { prefix: 'settlement:receivable:', template: STANDARD_BY_CODE.get('settlement:receivable')! },
  { prefix: 'lp:collateral:', template: STANDARD_BY_CODE.get('lp:collateral')! },
  { prefix: 'reserve:stellar:', template: STANDARD_BY_CODE.get('reserve:stellar')! },
  { prefix: 'user:wallet:', template: STANDARD_BY_CODE.get('user:wallet')! },
  { prefix: 'merchant:payable:', template: STANDARD_BY_CODE.get('merchant:payable')! },
  { prefix: 'payout:pending:', template: STANDARD_BY_CODE.get('payout:pending')! },
  { prefix: 'twin:backing:', template: STANDARD_BY_CODE.get('twin:backing')! },
  { prefix: 'equity:protocol:', template: STANDARD_BY_CODE.get('equity:protocol')! },
  { prefix: 'equity:fees:', template: STANDARD_BY_CODE.get('equity:fees')! },
  { prefix: 'equity:treasury:', template: STANDARD_BY_CODE.get('equity:treasury')! },
  { prefix: 'revenue:fees:', template: STANDARD_BY_CODE.get('revenue:fees')! },
  { prefix: 'revenue:fx:', template: STANDARD_BY_CODE.get('revenue:fx')! },
  { prefix: 'expense:connector:', template: STANDARD_BY_CODE.get('expense:connector')! },
  { prefix: 'expense:chain:', template: STANDARD_BY_CODE.get('expense:chain')! },
];

/** Standalone equity/revenue/expense codes that aren't parameterized. */
const STANDALONE_CODES = new Set([
  'equity:protocol', 'equity:fees', 'equity:treasury',
  'revenue:fx',
  'expense:connector', 'expense:chain',
  'settlement:receivable',
]);

/**
 * Resolve any account code (standard or parameterized) to a LedgerAccount.
 * Parameterized codes inherit type/normalBalance from their template.
 * Unknown codes default to an asset account with debit normal balance
 * (this preserves ledger integrity — the trial balance invariant only
 * requires debits === credits, not account-type correctness).
 */
export function getAccount(code: string): LedgerAccount {
  const exact = STANDARD_BY_CODE.get(code);
  if (exact) return exact;

  for (const { prefix, template } of PARAMETERIZED_PREFIXES) {
    if (code.startsWith(prefix)) {
      const tail = code.slice(prefix.length);
      // The tail may be a currency (e.g. "GHS"), an asset code ("TWINGHS"),
      // a merchantId, a walletId, or a "holder:${id}" suffix.
      const currency = looksLikeCurrency(tail) ? tail : undefined;
      return {
        code,
        name: `${template.name} — ${tail}`,
        type: template.type,
        normalBalance: template.normalBalance,
        currency,
      };
    }
  }

  if (STANDALONE_CODES.has(code)) {
    return STANDARD_BY_CODE.get(code)!;
  }

  // Unknown — default to asset/debit to preserve balance invariants.
  return {
    code,
    name: `Unknown account — ${code}`,
    type: 'asset',
    normalBalance: 'debit',
  };
}

const CURRENCY_SET: Set<string> = new Set<string>([
  'KES', 'GHS', 'NGN', 'USD', 'ZAR', 'UGX', 'TZS',
]);

function looksLikeCurrency(s: string): boolean {
  if (CURRENCY_SET.has(s)) return true;
  // Twin Token asset codes look like `TWIN<CCY>`.
  if (s.startsWith('TWIN') && s.length > 4) {
    return CURRENCY_SET.has(s.slice(4));
  }
  return false;
}

/** Extract the underlying currency from a Twin Token asset code (e.g. TWINGHS → GHS). */
export function twinAssetToCurrency(assetCode: string): string {
  if (assetCode.startsWith('TWIN') && assetCode.length > 4) {
    return assetCode.slice(4);
  }
  return assetCode;
}

/** Convenience: filter chart of accounts by type. */
export function accountsByType(type: AccountType): LedgerAccount[] {
  return CHART_OF_ACCOUNTS.filter((a) => a.type === type);
}

/** All supported currency codes (re-exported for convenience). */
export const CURRENCIES: readonly string[] = [
  'KES', 'GHS', 'NGN', 'USD', 'ZAR', 'UGX', 'TZS',
] as const;

/** Type alias for the CurrencyCode used elsewhere in the protocol. */
export type { CurrencyCode };
