/**
 * Risk Engine — scores the risk of a candidate settlement plan.
 *
 * Combines reserve headroom, LP concentration, FX exposure and path length
 * into a single 0..1 risk score and a human label. The Routing Engine uses
 * this to rank "safest" paths; the simulator surfaces it alongside confidence.
 */
import type { LpUsage, ReserveConfig } from './types';

export interface RiskInput {
  reserves: ReserveConfig[];
  lpUsage: LpUsage[];
  amount: number;
  pathLength: number;
  fxSpreadBps: number;
  preference: 'fastest' | 'cheapest' | 'safest';
}

export interface RiskResult {
  score: number; // 0..1 (lower is safer)
  label: 'Low' | 'Moderate' | 'Elevated';
  confidence: number; // 0..100
  factors: { name: string; contribution: number; detail: string }[];
}

export class RiskEngine {
  assess(input: RiskInput): RiskResult {
    const factors: RiskResult['factors'] = [];

    // 1. Reserve headroom — how close any reserve falls to its threshold.
    let reserveRisk = 0;
    for (const r of input.reserves) {
      // Skip empty conduit reserves (no balance and no threshold) — they are
      // not funding this payment and add no risk.
      if (r.balance === 0 && r.minThreshold === 0) continue;
      const headroom = r.balance - r.minThreshold;
      if (headroom < 0) {
        reserveRisk = Math.max(reserveRisk, 0.5);
        factors.push({
          name: 'Reserve breach',
          contribution: 0.5,
          detail: `${r.country} reserve below minimum threshold`,
        });
      } else if (r.minThreshold > 0) {
        const ratio = headroom / Math.max(r.balance, 1);
        const contribution = Math.max(0, 0.08 * (1 - ratio));
        reserveRisk = Math.max(reserveRisk, contribution);
        if (contribution > 0.015) {
          factors.push({
            name: `Reserve headroom (${r.country})`,
            contribution,
            detail: `${r.country} reserve has ${Math.round(ratio * 100)}% headroom above threshold`,
          });
        }
      }
    }

    // 2. LP concentration — reliance on a single LP.
    const totalDrawn = input.lpUsage.reduce((s, u) => s + u.drawn, 0) || 1;
    const maxShare = Math.max(...input.lpUsage.map((u) => u.drawn / totalDrawn), 0);
    const concentrationRisk = input.lpUsage.length > 1 ? maxShare * 0.08 : 0.12;
    factors.push({
      name: 'LP concentration',
      contribution: concentrationRisk,
      detail:
        input.lpUsage.length > 1
          ? `Largest LP carries ${Math.round(maxShare * 100)}% of liquidity`
          : 'Single-LP path — no diversification',
    });

    // 3. Path length — more hops => more failure surface.
    const pathRisk = Math.min(0.06, input.pathLength * 0.008);
    factors.push({
      name: 'Path length',
      contribution: pathRisk,
      detail: `${input.pathLength} hops in settlement path`,
    });

    // 4. FX exposure.
    const fxRisk = Math.min(0.06, input.fxSpreadBps / 1000);
    factors.push({
      name: 'FX exposure',
      contribution: fxRisk,
      detail: `${input.fxSpreadBps} bps spread`,
    });

    const score = Math.min(
      1,
      Math.round((reserveRisk + concentrationRisk + pathRisk + fxRisk) * 1e4) / 1e4,
    );
    const label: RiskResult['label'] =
      score < 0.15 ? 'Low' : score < 0.35 ? 'Moderate' : 'Elevated';

    // Confidence is inverse of risk, lifted slightly because the kernel
    // controls the whole path end-to-end.
    const confidence = Math.max(80, Math.round((1 - score) * 100));

    return { score, label, confidence, factors: factors.filter((f) => f.contribution > 0.001) };
  }
}

export const riskEngine = new RiskEngine();
