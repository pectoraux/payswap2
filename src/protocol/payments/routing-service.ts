/**
 * PaySwap Protocol — Routing Service.
 *
 * Selects the optimal settlement path using the kernel planner + liquidity
 * marketplace. Asks: "Which available actor has the highest probability of
 * completing this transition?"
 *
 * NOT: "Who has the biggest balance?"
 */
import { type Entity, type Evidence, ConvergencePlanner } from '@/kernel';
import { liquidityMarketplace, type LPProfile, type LPCapacityQuote } from '../liquidity/marketplace';
import { lpLifecycle } from '../lp-lifecycle-manager';
import type { PaymentIntent } from './payment-service';

export interface SettlementPlan {
  lpId: string;
  lpProfile: LPProfile;
  confidence: number;
  expectedCompletionMs: number;
  cost: number;
  costPercent: number;
  riskScore: number;
  transitions: { type: string; entityId: string; command: string; amount: number }[];
  alternativeLps: { lpId: string; score: number }[];
}

export class RoutingService {
  private planner = new ConvergencePlanner();

  /** Find the best settlement route for a payment. */
  findRoute(payment: PaymentIntent, entities: Entity[], evidence: Evidence[]): SettlementPlan | null {
    // 1. Find active LPs that can settle in the destination currency
    const activeLPs = liquidityMarketplace.activeLPsForCurrency(payment.destinationCurrency);
    if (activeLPs.length === 0) return null;

    // 2. For each LP, quote capacity (Capacity × Confidence × Availability × Exposure)
    const confidenceFn = (lpId: string): number => {
      const lpEvidence = evidence.filter((e) => e.entityId === lpId);
      if (lpEvidence.length === 0) return 0;
      // Use best evidence confidence
      return Math.max(...lpEvidence.map((e) => {
        const freshness = Math.max(0, (e.expiresAt - Date.now()) / (e.expiresAt - e.issuedAt));
        return (e.attestedAmount ?? 0) > 0 ? freshness * 0.8 : 0;
      }));
    };

    const quotes = liquidityMarketplace.quoteAll(payment.destinationCurrency, evidence, confidenceFn);
    if (quotes.length === 0) return null;

    // 3. Filter LPs with sufficient effective capacity
    const viable = quotes.filter((q) => q.effectiveCapacity >= payment.destinationAmount);
    if (viable.length === 0) return null;

    // 4. Score each LP (probability of successful convergence)
    const scored = viable.map((q) => {
      const profile = liquidityMarketplace.getProfile(q.lpId);
      if (!profile) return null;

      // Score = confidence × historical success × capacity utilization inverse × speed
      const utilizationPenalty = q.utilization > 0.8 ? 0.5 : q.utilization > 0.5 ? 0.8 : 1.0;
      const speedScore = Math.max(0.3, 1 - profile.settlementSpeedMs / 120000);
      const score = q.confidence * profile.historicalSuccess * utilizationPenalty * speedScore;

      return {
        quote: q,
        profile,
        score,
        cost: round(payment.destinationAmount * profile.feeBps / 10000, 2),
        costPercent: round(profile.feeBps / 100, 2),
        expectedMs: profile.settlementSpeedMs,
        riskScore: round(1 - profile.historicalSuccess, 4),
      };
    }).filter((s): s is NonNullable<typeof s> => s !== null);

    if (scored.length === 0) return null;

    // 5. Sort by score (highest probability of convergence)
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const alternatives = scored.slice(1, 4).map((s) => ({ lpId: s.profile.id, score: round(s.score, 4) }));

    // 6. Build settlement plan
    const plan: SettlementPlan = {
      lpId: best.profile.id,
      lpProfile: best.profile,
      confidence: round(best.quote.confidence, 4),
      expectedCompletionMs: best.expectedMs,
      cost: best.cost,
      costPercent: best.costPercent,
      riskScore: best.riskScore,
      transitions: [
        { type: 'debit', entityId: `sender:${payment.senderId}`, command: 'TransferLiquidity', amount: payment.sourceAmount },
        { type: 'bridge', entityId: `lp:${best.profile.id}`, command: 'BridgeLiquidity', amount: payment.destinationAmount },
        { type: 'credit', entityId: `receiver:${payment.receiverId}`, command: 'TransferLiquidity', amount: payment.destinationAmount },
      ],
      alternativeLps: alternatives,
    };

    return plan;
  }

  /** Find an alternative LP (excluding specific LPs). */
  findAlternative(paymentId: string, excludeLpIds: string[], entities: Entity[], evidence: Evidence[]): SettlementPlan | null {
    // Temporarily mark excluded LPs as offline
    const originalStates = excludeLpIds.map((id) => {
      const profile = liquidityMarketplace.getProfile(id);
      if (profile) { const orig = profile.online; profile.online = false; return { id, orig }; }
      return null;
    });

    // Get payment from first available
    const payments = (this as any).paymentService?.listPayments?.() ?? [];
    const payment = payments.find((p: PaymentIntent) => p.id === paymentId);
    const result = payment ? this.findRoute(payment, entities, evidence) : null;

    // Restore original states
    originalStates.forEach((s) => { if (s && liquidityMarketplace.getProfile(s.id)) liquidityMarketplace.getProfile(s.id)!.online = s.orig; });

    return result;
  }
}

function round(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}
