/** Simulator UI formatting helpers (client-safe, mirrors kernel formatting). */
import { CURRENCIES, COUNTRY_FLAGS, type CurrencyCode } from '@/kernel';

export function fmtMoney(amount: number, currency: CurrencyCode): string {
  const meta = CURRENCIES[currency];
  if (!meta) return `${amount}`;
  const value = Math.round((amount + Number.EPSILON) * Math.pow(10, meta.decimals)) / Math.pow(10, meta.decimals);
  return `${meta.symbol} ${value.toLocaleString('en-US', {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  })}`;
}

export function fmtNumber(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function flag(country: string): string {
  return COUNTRY_FLAGS[country] ?? '🏳️';
}

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}
