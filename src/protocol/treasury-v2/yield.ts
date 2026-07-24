/**
 * Treasury v2 — Yield accounting.
 *
 * The YieldEngine records yield earned on treasury reserves (from staking,
 * DeFi deployment, FX hedging, etc.) and computes APY (annualized percentage
 * yield) per asset.
 *
 *   - `recordYield(assetCode, grossYield, source, period?)` — records one
 *     yield entry. If `period` is omitted, derives it from the current date
 *     (YYYY-MM-DD for daily, or a caller-supplied label).
 *   - `netYield(assetCode)` — gross yield minus the protocol fee share (10%
 *     by default; the fee accrues to equity:treasury).
 *   - `computeAPY(assetCode)` — annualized yield: (total net yield over the
 *     last 365 days / average reserve) × 100.
 *   - `yieldHistory(assetCode, range?)` — returns yield records for an asset
 *     within an optional [startTs, endTs] range.
 *
 * Yield is recorded per asset and per period, so the same asset can have
 * multiple yield entries from different sources in the same period.
 */
import { round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { YieldRecord } from './types';
import { PROTOCOL_FEE_SHARE } from './types';
import type { ReserveMonitor } from './reserve';

/** Milliseconds in a year (365 days). */
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Date label for a timestamp (YYYY-MM-DD, UTC). */
function dateLabel(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * YieldEngine — singleton-style class.
 */
export class YieldEngine {
  /** All yield records, in insertion order. */
  private records: YieldRecord[] = [];

  /**
   * Record a yield entry for an asset. The net yield is derived from the gross
   * yield minus the protocol fee share (10% by default). APY is computed from
   * the rolling 365-day total yield vs average reserve.
   *
   * Returns the recorded YieldRecord.
   */
  recordYield(
    assetCode: string,
    grossYield: number,
    source: string,
    period?: string,
    reserveMonitor?: ReserveMonitor,
    now: number = Date.now(),
  ): YieldRecord {
    const periodLabel = period ?? dateLabel(now);
    const gross = round(grossYield, 6);
    const fee = round(gross * PROTOCOL_FEE_SHARE, 6);
    const net = round(gross - fee, 6);
    const apy = this.computeAPY(assetCode, reserveMonitor, now);

    const record: YieldRecord = {
      period: periodLabel,
      assetCode,
      grossYield: gross,
      netYield: net,
      source,
      apy,
    };
    this.records.push(record);

    eventEngine.emit('treasury.yield_recorded', {
      assetCode,
      period: periodLabel,
      grossYield: gross,
      netYield: net,
      fee,
      source,
      apy,
    }, 0);
    return record;
  }

  /**
   * Compute the annualized percentage yield (APY) for an asset over the last
   * 365 days. APY = (total net yield over 365 days / average reserve) × 100.
   *
   * If no reserve monitor is supplied or the asset has no reserve, APY = 0
   * (we can't annualize without a denominator).
   *
   * If there are no yield records in the last 365 days, APY = 0.
   */
  computeAPY(assetCode: string, reserveMonitor?: ReserveMonitor, now: number = Date.now()): number {
    const cutoff = now - YEAR_MS;
    const recent = this.records.filter(
      (r) => r.assetCode === assetCode && new Date(r.period).getTime() >= cutoff,
    );
    if (recent.length === 0) return 0;
    const totalNet = round(recent.reduce((s, r) => s + r.netYield, 0), 6);
    if (!reserveMonitor) return 0;
    const currency = assetCode.startsWith('TWIN') ? assetCode.slice(4) : assetCode;
    const reserve = reserveMonitor.getReserve(currency);
    if (!reserve || reserve.balance <= 0) return 0;
    const apy = round((totalNet / reserve.balance) * 100, 4);
    return Math.max(0, apy);
  }

  /**
   * Get the most recent net yield for an asset (sum of net yields in the
   * current period). Returns 0 if no records.
   */
  netYield(assetCode: string, period?: string): number {
    const periodLabel = period ?? dateLabel(Date.now());
    const matches = this.records.filter((r) => r.assetCode === assetCode && r.period === periodLabel);
    return round(matches.reduce((s, r) => s + r.netYield, 0), 6);
  }

  /** Gross yield for an asset in a period. */
  grossYield(assetCode: string, period?: string): number {
    const periodLabel = period ?? dateLabel(Date.now());
    const matches = this.records.filter((r) => r.assetCode === assetCode && r.period === periodLabel);
    return round(matches.reduce((s, r) => s + r.grossYield, 0), 6);
  }

  /**
   * Yield history for an asset, optionally bounded by a [startTs, endTs]
   * range. Returns records in chronological order.
   */
  yieldHistory(assetCode: string, range?: { startTs?: number; endTs?: number }): YieldRecord[] {
    let list = this.records.filter((r) => r.assetCode === assetCode);
    if (range?.startTs !== undefined) {
      list = list.filter((r) => new Date(r.period).getTime() >= range.startTs!);
    }
    if (range?.endTs !== undefined) {
      list = list.filter((r) => new Date(r.period).getTime() <= range.endTs!);
    }
    return list.sort((a, b) => a.period.localeCompare(b.period));
  }

  /** All yield records (all assets, all periods). */
  all(): YieldRecord[] {
    return [...this.records];
  }

  /** Reset all state (test helper). */
  reset(): void {
    this.records = [];
  }
}

/** Singleton yield engine. */
export const yieldEngine = new YieldEngine();
