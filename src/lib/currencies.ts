/**
 * Comprehensive currency reference used by every LP form on PaySwap.
 *
 * 50+ major world currencies with their ISO 4217 code, display name, symbol
 * (for the dropdown preview), and the issuing country / region. The list is
 * hand-curated — it is NOT exhaustive — and is biased toward the corridors
 * PaySwap actually routes today (African mobile-money corridors plus the
 * usual G10 / EM majors).
 *
 * The shared `<CurrencySelect />` component reads this list verbatim and lets
 * LPs search by code, name, or symbol. Selecting an entry returns the
 * 3-letter ISO code only — that's what gets stored in `LPProfile.currencies`,
 * `Payment.currency`, etc.
 */

export interface CurrencyInfo {
  /** ISO 4217 3-letter code (e.g. "GHS"). Stored in the DB. */
  code: string;
  /** Human-readable name (e.g. "Ghanaian Cedi"). */
  name: string;
  /** Currency symbol used for inline display (e.g. "₵"). */
  symbol: string;
  /** Issuing country / region label (e.g. "Ghana"). */
  country: string;
  /** Optional decimals — informational only. */
  decimals?: number;
}

export const CURRENCIES: readonly CurrencyInfo[] = [
  // ── Major African corridors (PaySwap core market) ────────────────────
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', country: 'Ghana', decimals: 2 },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', country: 'Nigeria', decimals: 2 },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', country: 'Kenya', decimals: 2 },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', country: 'Uganda', decimals: 0 },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', country: 'Tanzania', decimals: 0 },
  { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', country: 'Rwanda', decimals: 0 },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA', country: 'West African Union', decimals: 0 },
  { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA', country: 'Central African Union', decimals: 0 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', country: 'South Africa', decimals: 2 },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', country: 'Egypt', decimals: 2 },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'DH', country: 'Morocco', decimals: 2 },
  { code: 'DZD', name: 'Algerian Dinar', symbol: 'DA', country: 'Algeria', decimals: 2 },
  { code: 'TND', name: 'Tunisian Dinar', symbol: 'DT', country: 'Tunisia', decimals: 3 },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br', country: 'Ethiopia', decimals: 2 },
  { code: 'GMD', name: 'Gambian Dalasi', symbol: 'D', country: 'Gambia', decimals: 2 },
  { code: 'SLL', name: 'Sierra Leonean Leone', symbol: 'Le', country: 'Sierra Leone', decimals: 2 },
  { code: 'LRD', name: 'Liberian Dollar', symbol: 'L$', country: 'Liberia', decimals: 2 },
  { code: 'CDF', name: 'Congolese Franc', symbol: 'FC', country: 'DR Congo', decimals: 2 },
  { code: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz', country: 'Angola', decimals: 2 },
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT', country: 'Mozambique', decimals: 2 },
  { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK', country: 'Zambia', decimals: 2 },
  { code: 'BWP', name: 'Botswanan Pula', symbol: 'P', country: 'Botswana', decimals: 2 },
  { code: 'MUR', name: 'Mauritian Rupee', symbol: '₨', country: 'Mauritius', decimals: 2 },
  { code: 'SCR', name: 'Seychellois Rupee', symbol: 'SRe', country: 'Seychelles', decimals: 2 },
  { code: 'LSL', name: 'Lesotho Loti', symbol: 'L', country: 'Lesotho', decimals: 2 },

  // ── G10 majors ───────────────────────────────────────────────────────
  { code: 'USD', name: 'US Dollar', symbol: '$', country: 'United States', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', country: 'Eurozone', decimals: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', country: 'United Kingdom', decimals: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr', country: 'Switzerland', decimals: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', country: 'Japan', decimals: 0 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', country: 'Canada', decimals: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', country: 'Australia', decimals: 2 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', country: 'New Zealand', decimals: 2 },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', country: 'Sweden', decimals: 2 },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', country: 'Norway', decimals: 2 },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', country: 'Denmark', decimals: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', country: 'Singapore', decimals: 2 },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', country: 'Hong Kong', decimals: 2 },

  // ── Emerging markets majors ──────────────────────────────────────────
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', country: 'China', decimals: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', country: 'India', decimals: 2 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', country: 'Brazil', decimals: 2 },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', country: 'Mexico', decimals: 2 },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', country: 'Russia', decimals: 2 },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', country: 'Turkey', decimals: 2 },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', country: 'Indonesia', decimals: 0 },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', country: 'Malaysia', decimals: 2 },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', country: 'Philippines', decimals: 2 },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', country: 'Thailand', decimals: 2 },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', country: 'Vietnam', decimals: 0 },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', country: 'Pakistan', decimals: 2 },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', country: 'Bangladesh', decimals: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', country: 'United Arab Emirates', decimals: 2 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', country: 'Saudi Arabia', decimals: 2 },
  { code: 'QAR', name: 'Qatari Riyal', symbol: '﷼', country: 'Qatar', decimals: 2 },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك', country: 'Kuwait', decimals: 3 },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '₪', country: 'Israel', decimals: 2 },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$', country: 'Argentina', decimals: 2 },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$', country: 'Chile', decimals: 0 },
  { code: 'COP', name: 'Colombian Peso', symbol: '$', country: 'Colombia', decimals: 0 },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', country: 'Peru', decimals: 2 },
];

/** Quick lookup map: code → CurrencyInfo. */
export const CURRENCY_MAP: ReadonlyMap<string, CurrencyInfo> = new Map(
  CURRENCIES.map((c) => [c.code, c]),
);

/**
 * Resolve a 3-letter code into its `CurrencyInfo`. Falls back to a minimal
 * stub (code-only) so unknown codes still render without crashing the UI.
 */
export function getCurrency(code: string | null | undefined): CurrencyInfo {
  if (code && CURRENCY_MAP.has(code)) {
    return CURRENCY_MAP.get(code)!;
  }
  return {
    code: code ?? '—',
    name: code ?? 'Unknown currency',
    symbol: '',
    country: '',
  };
}

/** Search predicate — matches code, name, symbol, or country (case-insensitive). */
export function matchCurrency(query: string, c: CurrencyInfo): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    c.code.toLowerCase().includes(q) ||
    c.name.toLowerCase().includes(q) ||
    c.symbol.toLowerCase().includes(q) ||
    c.country.toLowerCase().includes(q)
  );
}
