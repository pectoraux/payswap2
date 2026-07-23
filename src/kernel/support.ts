/**
 * Kernel support utilities — currencies, id generation, formatting.
 * Pure, dependency-free. Shared across all engines.
 */
import type { CurrencyCode, CurrencyMeta } from './types';

export const KERNEL_VERSION = '0.1.0-milestone-1';

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  KES: { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', decimals: 2, countries: ['Kenya'] },
  GHS: { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi', decimals: 2, countries: ['Ghana'] },
  NGN: { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', decimals: 2, countries: ['Nigeria'] },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', decimals: 2, countries: ['United States'] },
  ZAR: { code: 'ZAR', symbol: 'R', name: 'South African Rand', decimals: 2, countries: ['South Africa'] },
  UGX: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimals: 0, countries: ['Uganda'] },
  TZS: { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling', decimals: 0, countries: ['Tanzania'] },
};

export const COUNTRY_FLAGS: Record<string, string> = {
  Kenya: '🇰🇪',
  Ghana: '🇬🇭',
  Nigeria: '🇳🇬',
  'United States': '🇺🇸',
  'South Africa': '🇿🇦',
  Uganda: '🇺🇬',
  Tanzania: '🇹🇿',
};

let _seq = 0;
/** Monotonic id generator (deterministic within a single simulation run). */
export function uid(prefix: string): string {
  _seq += 1;
  const stamp = Date.now().toString(36).slice(-4);
  return `${prefix}_${stamp}${_seq.toString(36).padStart(3, '0')}`;
}

export function round(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function formatMoney(amount: number, currency: CurrencyCode): string {
  const meta = CURRENCIES[currency];
  const value = round(amount, meta.decimals);
  return `${meta.symbol} ${value.toLocaleString('en-US', {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  })}`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function nowTs(): number {
  return Date.now();
}
