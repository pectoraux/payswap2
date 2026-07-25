/**
 * Treasury v2 — Capital efficiency.
 *
 * Capital efficiency measures how effectively the treasury is using its
 * reserves to back Twin Token circulation. Four metrics per asset:
 *
 *   - `reserveRatio` : reserve.available / circulating. ≥1 = fully backed.
 *                      Higher = more conservative (more reserve per token).
 *   - `utilization`  : circulating / (circulating + escrowed). 1.0 = all
 *                      tokens in active circulation (none escrowed). Lower =
 *                      more tokens locked in settlement.
 *   - `velocity`     : annualized tx volume / reserve. Higher = each unit of
 *                      reserve supports more economic activity.
 *   - `efficiency`   : composite 0..1 — higher = more capital-efficient.
 *                      efficiency = utilization × velocityFactor × (1 − reservePenalty)
 *                      where reservePenalty = max(0, reserveRatio − 1) × 0.5
 *                      (excess reserve is a drag on efficiency) and
 *                      velocityFactor = min(1, velocity / 50) (50x annualized
 *                      velocity = "excellent").
 *
 * The efficiency is bounded to [0, 1]. An asset with reserveRatio = 1.0,
 * utilization = 1.0 and velocity = 50 has efficiency = 1.0.
 */
import { round } from '@/kernel/support';
import type { CapitalEfficiency } from './types';
import type { TwinTokenEngine } from '@/protocol/twin-token/engine';
import type { ReserveMonitor } from './reserve';

/** Default velocity scale — 50x annualized velocity = "excellent". */
const VELOCITY_SCALE = 50;

/** Maximum reserve-ratio penalty (50% drag at reserveRatio ≥ 2). */
const MAX_RESERVE_PENALTY = 0.5;

/**
 * Compute capital efficiency for a single asset.
 *
 *   - `txVolumeAnnualized` : optional — the annualized transaction volume for
 *                            this asset (used for velocity). If not supplied,
 *                            velocity = 0.
 */
export function computeCapitalEfficiency(
  assetCode: string,
  twinTokenEngine: TwinTokenEngine,
  reserveMonitor: ReserveMonitor,
  txVolumeAnnualized?: number,
): CapitalEfficiency {
  const asset = twinTokenEngine.getAsset(assetCode);
  if (!asset) {
    return {
      assetCode,
      reserveRatio: 0,
      utilization: 0,
      velocity: 0,
      efficiency: 0,
    };
  }
  const circulating = round(asset.circulating, 6);
  const escrowed = round(asset.escrowed, 6);
  const totalSupply = round(circulating + escrowed, 6);
  const reserve = round(reserveMonitor.available(asset.currency), 6);

  // reserveRatio: reserve / circulating. If circulating = 0, ratio = 1
  // (no liabilities = trivially backed).
  const reserveRatio = circulating > 0 ? round(reserve / circulating, 6) : 1;

  // utilization: circulating / (circulating + escrowed). 0 if no supply.
  const utilization = totalSupply > 0 ? round(circulating / totalSupply, 6) : 0;

  // velocity: annualized tx volume / reserve. 0 if no reserve or no volume.
  const velocity = reserve > 0 && txVolumeAnnualized !== undefined
    ? round(txVolumeAnnualized / reserve, 6)
    : 0;

  // efficiency: composite 0..1.
  // velocityFactor = min(1, velocity / VELOCITY_SCALE).
  const velocityFactor = Math.min(1, velocity / VELOCITY_SCALE);
  // reservePenalty = max(0, reserveRatio − 1) × 0.5, capped at MAX_RESERVE_PENALTY.
  const reservePenalty = Math.min(MAX_RESERVE_PENALTY, Math.max(0, reserveRatio - 1) * 0.5);
  const efficiency = round(Math.max(0, Math.min(1, utilization * velocityFactor * (1 - reservePenalty))), 4);

  return { assetCode, reserveRatio, utilization, velocity, efficiency };
}

/**
 * Compute capital efficiency for every registered Twin Token asset. Returns
 * an array of `CapitalEfficiency` records (one per asset).
 *
 * `txVolumeMap` : optional map of assetCode → annualized tx volume.
 */
export function efficiencyReport(
  twinTokenEngine: TwinTokenEngine,
  reserveMonitor: ReserveMonitor,
  txVolumeMap?: Record<string, number>,
): CapitalEfficiency[] {
  return twinTokenEngine.allAssets().map((a) =>
    computeCapitalEfficiency(a.code, twinTokenEngine, reserveMonitor, txVolumeMap?.[a.code]),
  );
}
