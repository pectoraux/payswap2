/** Digital Twin UI formatting helpers (client-safe). */
import { CURRENCIES, COUNTRY_FLAGS, FO_META, type CurrencyCode, type FinancialOperatorType, type LiquiditySourceKind } from '@/kernel';

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

export function foIcon(type: FinancialOperatorType): string {
  return FO_META[type]?.icon ?? '🔌';
}

export function foLabel(type: FinancialOperatorType): string {
  return FO_META[type]?.label ?? type;
}

export function sourceKindLabel(kind: LiquiditySourceKind): string {
  const map: Record<LiquiditySourceKind, string> = {
    reserve: 'Reserve',
    community_lp: 'Community LP',
    merchant_lp: 'Merchant LP',
    stablecoin_treasury: 'Stablecoin Treasury',
    bank_credit_line: 'Bank Credit Line',
    cooperative_pool: 'Cooperative Pool',
    diaspora_pool: 'Diaspora Pool',
    emergency_treasury: 'Emergency Treasury',
  };
  return map[kind] ?? kind;
}

export function sourceKindColor(kind: LiquiditySourceKind): string {
  const map: Record<LiquiditySourceKind, string> = {
    reserve: 'text-amber-500',
    community_lp: 'text-emerald-500',
    merchant_lp: 'text-teal-500',
    stablecoin_treasury: 'text-violet-500',
    bank_credit_line: 'text-sky-500',
    cooperative_pool: 'text-lime-500',
    diaspora_pool: 'text-rose-500',
    emergency_treasury: 'text-orange-500',
  };
  return map[kind] ?? 'text-muted-foreground';
}
