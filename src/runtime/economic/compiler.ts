/**
 * Economic Compiler — upgrades the Financial Compiler to produce economic
 * execution plans. (M-RT-25, Economic Kernel.)
 *
 * OLD pipeline:
 *   Intent → Execution Plan
 *
 * NEW pipeline:
 *   Intent → Marketplace → Economic Graph → LP Offers → Multi-hop Optimization
 *          → Twin Token Accounting → Execution Plan
 *
 * The compiler requests offers from the marketplace, finds the best path
 * (using multi-hop optimization), and produces an EconomicExecutionPlan
 * that includes twin token accounting (which tokens to mint/burn/transfer).
 */

import type { LiquidityRequest, MarketplaceResponse, ExecutionCandidate } from './marketplace';
import type { EconomicMarketplace } from './marketplace';
import type { LPOffer } from './lp-runtime';
import type { TokenType } from './twin-token-types';

// ─── Economic Execution Plan ───────────────────────────────────────────────

/** One step in an economic execution plan. */
export interface EconomicStep {
  stepType: 'mint' | 'burn' | 'transfer' | 'convert' | 'settle';
  tokenType: TokenType;
  accountId: string;
  currency: string;
  amount: number;
  lpId?: string;
  reason: string;
}

/** A complete economic execution plan. */
export interface EconomicExecutionPlan {
  intentId: string;
  from: string;
  to: string;
  amount: number;
  /** The LP offers selected (the "path"). */
  path: LPOffer[];
  /** The twin token steps (mint/burn/transfer/convert). */
  steps: EconomicStep[];
  /** Total cost in bps. */
  totalCostBps: number;
  /** The marketplace response (for explainability). */
  marketplaceResponse: MarketplaceResponse | null;
  /** Whether the plan is feasible (has liquidity). */
  feasible: boolean;
  /** Why the plan was chosen (human-readable). */
  rationale: string;
}

// ─── Economic Intent ───────────────────────────────────────────────────────

export interface EconomicIntent {
  intentId: string;
  from: string;
  to: string;
  amount: number;
  /** The wallet/account initiating the transfer. */
  sourceAccountId: string;
  /** The wallet/account receiving the transfer. */
  destinationAccountId: string;
  /** The treasury account backing the source. */
  treasuryAccountId: string;
}

// ─── Economic Compiler ─────────────────────────────────────────────────────

/**
 * EconomicCompiler — produces economic execution plans.
 *
 * Pipeline:
 *   1. Request offers from the marketplace
 *   2. Try multi-hop optimization
 *   3. Select the best path
 *   4. Generate twin token accounting steps
 *   5. Return EconomicExecutionPlan
 *
 * Pure: same intent + marketplace state → same plan.
 */
export class EconomicCompiler {
  constructor(private marketplace: EconomicMarketplace) {}

  /**
   * Compile an economic intent into an execution plan.
   */
  compile(intent: EconomicIntent): EconomicExecutionPlan {
    // Step 1: Request offers from the marketplace.
    const request: LiquidityRequest = {
      from: intent.from,
      to: intent.to,
      amount: intent.amount,
    };

    const marketplaceResponse = this.marketplace.requestOffers(request);

    // Step 2: Try multi-hop if no direct offer.
    let path: LPOffer[] = [];
    let totalCostBps = 0;
    let rationale = '';

    if (marketplaceResponse.bestCandidate && marketplaceResponse.bestCandidate.canHandleAmount) {
      // Direct offer available.
      path = [marketplaceResponse.bestCandidate.offer];
      totalCostBps = marketplaceResponse.bestCandidate.totalCostBps;
      rationale = `Direct offer from LP ${marketplaceResponse.bestCandidate.offer.lpId} (spread=${marketplaceResponse.bestCandidate.offer.spreadBps}bps, score=${marketplaceResponse.bestCandidate.score.toFixed(3)})`;
    } else {
      // Try multi-hop.
      const multiHop = this.marketplace.requestMultiHop(request, 3);
      if (multiHop.feasible) {
        path = multiHop.path;
        totalCostBps = multiHop.totalCostBps;
        rationale = `Multi-hop path through ${path.length} LPs: ${path.map((o) => o.lpId).join(' → ')}`;
      } else if (marketplaceResponse.bestCandidate) {
        // Use partial direct offer (best available).
        path = [marketplaceResponse.bestCandidate.offer];
        totalCostBps = marketplaceResponse.bestCandidate.totalCostBps;
        rationale = `Partial offer from LP ${marketplaceResponse.bestCandidate.offer.lpId} (capacity ${marketplaceResponse.bestCandidate.offer.capacity} < requested ${intent.amount})`;
      } else {
        rationale = 'No liquidity available';
      }
    }

    // Step 3: Generate twin token accounting steps.
    const steps = this.generateTwinTokenSteps(intent, path);

    // Step 4: Return the plan.
    return {
      intentId: intent.intentId,
      from: intent.from,
      to: intent.to,
      amount: intent.amount,
      path,
      steps,
      totalCostBps,
      marketplaceResponse,
      feasible: path.length > 0,
      rationale,
    };
  }

  /**
   * Generate twin token accounting steps for a path.
   *
   * Value flow:
   *   1. Burn claim tokens from source wallet
   *   2. Convert claim → settlement at treasury
   *   3. For each LP hop: transfer settlement tokens
   *   4. Convert settlement → claim at destination
   *   5. Mint claim tokens to destination wallet
   */
  private generateTwinTokenSteps(intent: EconomicIntent, path: LPOffer[]): EconomicStep[] {
    const steps: EconomicStep[] = [];

    if (path.length === 0) return steps;

    // 1. Burn claim tokens from source.
    steps.push({
      stepType: 'burn',
      tokenType: 'claim',
      accountId: intent.sourceAccountId,
      currency: intent.from,
      amount: intent.amount,
      reason: 'Burn claim tokens from source wallet',
    });

    // 2. Convert claim → settlement at treasury.
    steps.push({
      stepType: 'convert',
      tokenType: 'settlement', // toTokenType
      accountId: intent.treasuryAccountId,
      currency: intent.from,
      amount: intent.amount,
      reason: 'Convert claim → settlement at treasury',
    });
    // Note: the 'convert' step implies fromTokenType = claim, toTokenType = settlement.
    // The twin token projection handles this via twin.converted events.

    // 3. For each LP hop: transfer settlement tokens.
    for (const offer of path) {
      steps.push({
        stepType: 'transfer',
        tokenType: 'settlement',
        accountId: intent.treasuryAccountId,
        currency: offer.from,
        amount: intent.amount,
        lpId: offer.lpId,
        reason: `Transfer settlement to LP ${offer.lpId} for ${offer.from}→${offer.to}`,
      });

      // If the hop crosses currencies, add a convert step.
      if (offer.from !== offer.to) {
        steps.push({
          stepType: 'convert',
          tokenType: 'settlement',
          accountId: intent.treasuryAccountId,
          currency: offer.to,
          amount: intent.amount,
          lpId: offer.lpId,
          reason: `FX convert ${offer.from}→${offer.to} via LP ${offer.lpId}`,
        });
      }
    }

    // 4. Convert settlement → claim at treasury (destination side).
    steps.push({
      stepType: 'convert',
      tokenType: 'claim',
      accountId: intent.treasuryAccountId,
      currency: intent.to,
      amount: intent.amount,
      reason: 'Convert settlement → claim at treasury (destination)',
    });

    // 5. Mint claim tokens to destination.
    steps.push({
      stepType: 'mint',
      tokenType: 'claim',
      accountId: intent.destinationAccountId,
      currency: intent.to,
      amount: intent.amount,
      reason: 'Mint claim tokens to destination wallet',
    });

    return steps;
  }
}
