/**
 * Kernel support utilities — currencies, countries, FO metadata, ids, formatting.
 * Pure, dependency-free. Shared across all engines.
 */
import type { CurrencyCode, CurrencyMeta, Country, FinancialOperatorType, OptimizationWeights, RoutingPriority } from './types';

export const KERNEL_VERSION = '1.5.0-simplified';

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

export const COUNTRIES: Country[] = [
  { name: 'Kenya', currency: 'KES', flag: '🇰🇪', region: 'East Africa' },
  { name: 'Ghana', currency: 'GHS', flag: '🇬🇭', region: 'West Africa' },
  { name: 'Nigeria', currency: 'NGN', flag: '🇳🇬', region: 'West Africa' },
  { name: 'South Africa', currency: 'ZAR', flag: '🇿🇦', region: 'Southern Africa' },
  { name: 'Uganda', currency: 'UGX', flag: '🇺🇬', region: 'East Africa' },
  { name: 'Tanzania', currency: 'TZS', flag: '🇹🇿', region: 'East Africa' },
];

export const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({
  country: c.name,
  currency: c.currency,
  methods: ['Mobile Money', 'Bank Transfer', 'Card'],
}));

export const FO_META: Record<FinancialOperatorType, { label: string; icon: string; baseLatencyMs: number; baseFeeBps: number; baseUptime: number }> = {
  mobile_money: { label: 'Mobile Money', icon: '📱', baseLatencyMs: 12000, baseFeeBps: 80, baseUptime: 0.985 },
  visa: { label: 'Visa', icon: '💳', baseLatencyMs: 4000, baseFeeBps: 150, baseUptime: 0.999 },
  mastercard: { label: 'Mastercard', icon: '💳', baseLatencyMs: 4000, baseFeeBps: 150, baseUptime: 0.999 },
  bank_account: { label: 'Bank Account', icon: '🏦', baseLatencyMs: 30000, baseFeeBps: 40, baseUptime: 0.97 },
  ach: { label: 'ACH', icon: '🏦', baseLatencyMs: 86400000, baseFeeBps: 25, baseUptime: 0.995 },
  sepa: { label: 'SEPA', icon: '🏦', baseLatencyMs: 86400000, baseFeeBps: 25, baseUptime: 0.995 },
  instant_transfer: { label: 'Instant Transfer', icon: '⚡', baseLatencyMs: 3000, baseFeeBps: 120, baseUptime: 0.99 },
  card_processor: { label: 'Card Processor', icon: '💳', baseLatencyMs: 5000, baseFeeBps: 130, baseUptime: 0.992 },
  psp_wallet: { label: 'PSP Wallet', icon: '👛', baseLatencyMs: 6000, baseFeeBps: 90, baseUptime: 0.988 },
};

/** Priority presets map to optimization weight profiles. */
export const PRIORITY_WEIGHTS: Record<RoutingPriority, OptimizationWeights> = {
  cheapest: { cost: 0.7, speed: 0.1, safety: 0.2, liquidityPreservation: 0.2, merchantSatisfaction: 0.3, communityImpact: 0.05, carbonImpact: 0.05, treasuryHealth: 0.3 },
  fastest: { cost: 0.1, speed: 0.7, safety: 0.2, liquidityPreservation: 0.1, merchantSatisfaction: 0.4, communityImpact: 0.05, carbonImpact: 0.05, treasuryHealth: 0.2 },
  safest: { cost: 0.15, speed: 0.15, safety: 0.7, liquidityPreservation: 0.4, merchantSatisfaction: 0.3, communityImpact: 0.1, carbonImpact: 0.1, treasuryHealth: 0.4 },
  balanced: { cost: 0.25, speed: 0.25, safety: 0.25, liquidityPreservation: 0.25, merchantSatisfaction: 0.25, communityImpact: 0.15, carbonImpact: 0.15, treasuryHealth: 0.25 },
  impact: { cost: 0.2, speed: 0.1, safety: 0.3, liquidityPreservation: 0.2, merchantSatisfaction: 0.2, communityImpact: 0.5, carbonImpact: 0.4, treasuryHealth: 0.2 },
};

let _seq = 0;
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

/** Deterministic hash of a result's key metrics — for regression comparison. */
export function hashMetrics(m: { costPercent: number; settlementTimeMs: number; riskScore: number; confidence: number }): string {
  const s = `${m.costPercent.toFixed(3)}|${m.settlementTimeMs}|${m.riskScore.toFixed(3)}|${m.confidence}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(36)}`;
}
