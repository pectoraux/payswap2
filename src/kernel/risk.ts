/**
 * Risk Engine — multi-dimensional, explainable risk scoring.
 *
 * Combines reserve headroom, LP concentration, FX exposure, path length and
 * treasury draw into a single 0..1 risk score. Lower = safer. Every factor is
 * surfaced so the AI recommendation can explain WHY a path is risky.
 */
import type { LiquiditySourceDraw, Reserve, RoutingPriority } from './types';

export interface RiskInput {
  reserves: Reserve[];
  lpUsage: LiquiditySourceDraw[];
  amount: number;
  pathLength: number;
  fxSpreadBps: number;
  preference: RoutingPriority;
  treasuryDraw: number;
}

export interface RiskResult {
  score: number;
  label: 'Low' | 'Moderate' | 'Elevated' | 'High';
  confidence: number;
  factors: { name: string; contribution: number; detail: string }[];
}

export class RiskEngine {
  assess(input: RiskInput): RiskResult {
    const factors: RiskResult['factors'] = [];

    let reserveRisk = 0;
    for (const r of input.reserves) {
      if (r.available === 0 && r.minThreshold === 0) continue;
      const headroom = r.available - r.minThreshold;
      if (headroom < 0) {
        reserveRisk = Math.max(reserveRisk, 0.5);
        factors.push({ name: 'Reserve breach', contribution: 0.5, detail: `${r.country} reserve below minimum threshold` });
      } else if (r.minThreshold > 0) {
        const ratio = headroom / Math.max(r.available, 1);
        const contribution = Math.max(0, 0.08 * (1 - ratio));
        reserveRisk = Math.max(reserveRisk, contribution);
        if (contribution > 0.015) {
          factors.push({ name: `Reserve headroom (${r.country})`, contribution, detail: `${r.country} reserve has ${Math.round(ratio * 100)}% headroom` });
        }
      }
    }

    const totalDrawn = input.lpUsage.reduce((s, u) => s + u.drawn, 0) || 1;
    const maxShare = Math.max(...input.lpUsage.map((u) => u.drawn / totalDrawn), 0);
    const concentrationRisk = input.lpUsage.length > 1 ? maxShare * 0.08 : 0.12;
    factors.push({
      name: 'LP concentration',
      contribution: concentrationRisk,
      detail: input.lpUsage.length > 1 ? `Largest LP carries ${Math.round(maxShare * 100)}%` : 'Single-LP path — no diversification',
    });

    const manualRisk = input.lpUsage.filter((u) => u.manual).length * 0.06;
    if (manualRisk > 0) {
      factors.push({ name: 'Manual settlement', contribution: manualRisk, detail: `${input.lpUsage.filter((u) => u.manual).length} manual LP(s) — workflow required` });
    }

    const pathRisk = Math.min(0.06, input.pathLength * 0.008);
    factors.push({ name: 'Path length', contribution: pathRisk, detail: `${input.pathLength} steps in execution graph` });

    const fxRisk = Math.min(0.06, input.fxSpreadBps / 1000);
    factors.push({ name: 'FX exposure', contribution: fxRisk, detail: `${input.fxSpreadBps} bps spread` });

    const treasuryRisk = input.treasuryDraw > 0 ? 0.04 : 0;
    if (treasuryRisk > 0) factors.push({ name: 'Treasury draw', contribution: treasuryRisk, detail: 'Treasury liquidity consumed — monitor health' });

    const score = Math.min(1, Math.round((reserveRisk + concentrationRisk + manualRisk + pathRisk + fxRisk + treasuryRisk) * 1e4) / 1e4);
    const label: RiskResult['label'] = score < 0.15 ? 'Low' : score < 0.3 ? 'Moderate' : score < 0.5 ? 'Elevated' : 'High';
    const confidence = Math.max(75, Math.round((1 - score) * 100));

    return { score, label, confidence, factors: factors.filter((f) => f.contribution > 0.001) };
  }
}

export const riskEngine = new RiskEngine();
