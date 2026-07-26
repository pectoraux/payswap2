/**
 * PaySwap Protocol — Ledger Chart of Accounts.
 *
 * The protocol ledger is a multi-currency double-entry book that mirrors every
 * value movement in the protocol layer (twin tokens, wallets, payouts,
 * settlement, treasury). It is the single source of truth for "where did the
 * money go" — independent of the kernel's own internal ledger, which is used
 * for simulation-state accounting.
 *
 * Account codes are namespaced strings (type shown in parentheses):
 *
 *   twintoken:circulating:${assetCode}   — twin tokens in circulation (asset)
 *   twin:backing:${currency}              — fiat backing owed to LPs (liability)
 *   twintoken:escrowed:${assetCode}      — twin tokens locked in escrow (asset)
 *   cash:bank:${currency}                 — bank-held fiat (asset)
 *   cash:mmo:${currency}                  — mobile-money-operator fiat (asset)
 *   user:wallet:${walletId}              — user wallet liability (liability)
 *   merchant:payable:${merchantId}       — merchant payable (liability)
 *   payout:pending                       — payouts awaiting rail (liability)
 *   settlement:receivable                — settlement owed to protocol (asset)
 *   lp:collateral                        — LP collateral held (asset)
 *   reserve:stellar                      — on-chain reserve (asset)
 *   equity:protocol                      — protocol equity (equity)
 *   equity:fees                          — accrued fees awaiting recognition (equity)
 *   equity:treasury                      — treasury-allocated equity (equity)
 *   revenue:fees:${method}               — fee revenue by payout method (revenue)
 *   revenue:fx                           — FX revenue (revenue)
 *   expense:connector                    — connector/PSP cost (expense)
 *   expense:chain                        — on-chain settlement cost (expense)
 *
 * Twin token accounting model: every minted token is backed 1:1 by fiat held
 * by an LP. The protocol tracks the issued tokens as a receivable (asset) and
 * the corresponding fiat deposit as a backing liability owed to the LP. This
 * gives the invariant: circulating + escrowed === backing liability.
 *
 * Account types follow the classical accounting equation:
 *   Assets = Liabilities + Equity
 * with revenue and expense accounts closing into equity at period end.
 */

/** Classical accounting account types. */
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

/** A chart-of-accounts definition entry. */
export interface AccountDefinition {
  /** Template or fully-qualified account code (may contain `${var}` segments). */
  code: string;
  /** Human-readable label. */
  label: string;
  /** Accounting type — drives debit/credit normal balance. */
  type: AccountType;
  /** Currency this account is denominated in, or 'multi' if mixed. */
  currency: 'multi' | string;
  /** True if the code contains `${var}` and is a template, not a leaf account. */
  template: boolean;
}

/**
 * Canonical chart of accounts. Templates (with `${var}`) describe families of
 * accounts; concrete accounts are derived at runtime by substituting the
 * variable (e.g. `twintoken:circulating:TWINGHS`).
 */
export const CHART_OF_ACCOUNTS: AccountDefinition[] = [
  // ---- Twin tokens ---------------------------------------------------------
  {
    code: 'twintoken:circulating:${assetCode}',
    label: 'Twin tokens in circulation',
    type: 'asset',
    currency: 'multi',
    template: true,
  },
  {
    code: 'twin:backing:${currency}',
    label: 'Fiat backing owed to LPs',
    type: 'liability',
    currency: 'multi',
    template: true,
  },
  {
    code: 'twintoken:escrowed:${assetCode}',
    label: 'Twin tokens held in escrow',
    type: 'asset',
    currency: 'multi',
    template: true,
  },

  // ---- Cash ----------------------------------------------------------------
  {
    code: 'cash:bank:${currency}',
    label: 'Bank-held cash',
    type: 'asset',
    currency: 'multi',
    template: true,
  },
  {
    code: 'cash:mmo:${currency}',
    label: 'Mobile-money-operator cash',
    type: 'asset',
    currency: 'multi',
    template: true,
  },

  // ---- User & merchant -----------------------------------------------------
  {
    code: 'user:wallet:${walletId}',
    label: 'User wallet liability',
    type: 'liability',
    currency: 'multi',
    template: true,
  },
  {
    code: 'merchant:payable:${merchantId}',
    label: 'Merchant payable',
    type: 'liability',
    currency: 'multi',
    template: true,
  },
  {
    code: 'payout:pending',
    label: 'Payouts pending rail confirmation',
    type: 'liability',
    currency: 'multi',
    template: false,
  },

  // ---- Settlement ----------------------------------------------------------
  {
    code: 'settlement:receivable',
    label: 'Settlement owed to protocol',
    type: 'asset',
    currency: 'multi',
    template: false,
  },
  {
    code: 'lp:collateral',
    label: 'LP collateral held',
    type: 'asset',
    currency: 'multi',
    template: false,
  },
  {
    code: 'reserve:stellar',
    label: 'On-chain Stellar reserve',
    type: 'asset',
    currency: 'multi',
    template: false,
  },

  // ---- Equity --------------------------------------------------------------
  {
    code: 'equity:protocol',
    label: 'Protocol equity',
    type: 'equity',
    currency: 'multi',
    template: false,
  },
  {
    code: 'equity:fees',
    label: 'Accrued fees awaiting recognition',
    type: 'equity',
    currency: 'multi',
    template: false,
  },
  {
    code: 'equity:treasury',
    label: 'Treasury-allocated equity',
    type: 'equity',
    currency: 'multi',
    template: false,
  },

  // ---- Revenue -------------------------------------------------------------
  {
    code: 'revenue:fees:${method}',
    label: 'Fee revenue by payout method',
    type: 'revenue',
    currency: 'multi',
    template: true,
  },
  {
    code: 'revenue:fx',
    label: 'FX revenue',
    type: 'revenue',
    currency: 'multi',
    template: false,
  },

  // ---- Expense -------------------------------------------------------------
  {
    code: 'expense:connector',
    label: 'Connector / PSP cost',
    type: 'expense',
    currency: 'multi',
    template: false,
  },
  {
    code: 'expense:chain',
    label: 'On-chain settlement cost',
    type: 'expense',
    currency: 'multi',
    template: false,
  },
];

/** Lookup map keyed by the prefix before the first `${` (or full code). */
const TEMPLATE_INDEX: Map<string, AccountDefinition> = new Map();
for (const def of CHART_OF_ACCOUNTS) {
  const key = def.template ? def.code.slice(0, def.code.indexOf('${')) : def.code;
  TEMPLATE_INDEX.set(key, def);
}

/**
 * Resolve a fully-qualified account code to its chart-of-accounts definition.
 * Returns undefined for unknown account namespaces.
 *
 * Example: `twintoken:circulating:TWINGHS` matches the
 * `twintoken:circulating:${assetCode}` template.
 */
export function getAccount(code: string): AccountDefinition | undefined {
  // Exact (non-template) match first.
  const exact = TEMPLATE_INDEX.get(code);
  if (exact && !exact.template) return exact;

  // Walk the prefix set, longest-match wins.
  let best: AccountDefinition | undefined;
  let bestLen = -1;
  for (const [prefix, def] of TEMPLATE_INDEX) {
    if (def.template && code.startsWith(prefix)) {
      if (prefix.length > bestLen) {
        best = def;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}

/** Account type for a code, defaulting to 'asset' if unknown. */
export function accountType(code: string): AccountType {
  return getAccount(code)?.type ?? 'asset';
}

/**
 * Map a Twin Token asset code (e.g. `TWINGHS`) to its underlying currency
 * (e.g. `GHS`). Twin token codes are conventionally `TWIN<CCY>`.
 */
export function twinAssetToCurrency(assetCode: string): string {
  if (assetCode.startsWith('TWIN')) return assetCode.slice(4);
  return assetCode;
}

/** Build a twin-token circulating account code from an asset code. */
export function circulatingAccount(assetCode: string): string {
  return `twintoken:circulating:${assetCode}`;
}

/** Build a twin-token escrowed account code from an asset code. */
export function escrowedAccount(assetCode: string): string {
  return `twintoken:escrowed:${assetCode}`;
}

/** Build a fiat backing account code from a currency. */
export function backingAccount(currency: string): string {
  return `twin:backing:${currency}`;
}

/** Build a bank cash account code from a currency. */
export function bankCashAccount(currency: string): string {
  return `cash:bank:${currency}`;
}

/** Build a mobile-money cash account code from a currency. */
export function mmoCashAccount(currency: string): string {
  return `cash:mmo:${currency}`;
}

/** Build a user wallet liability account code from a wallet id. */
export function userWalletAccount(walletId: string): string {
  return `user:wallet:${walletId}`;
}

/** Build a merchant payable account code from a merchant id. */
export function merchantPayableAccount(merchantId: string): string {
  return `merchant:payable:${merchantId}`;
}

/** Build a fee revenue account code from a payout method. */
export function feeRevenueAccount(method: string): string {
  return `revenue:fees:${method}`;
}
