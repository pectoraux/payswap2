/**
 * PaySwap Protocol — Risk Scoring Engine.
 *
 * Computes a composite 0–100 risk score for an entity from six weighted
 * factors and assigns one of four risk levels (low / medium / high /
 * prohibited). Scores are cached with a 90-day TTL — past expiry, the
 * payment flow must call `assessRisk(entityId)` again before relying
 * on the score.
 *
 * Risk factors (configurable weights, normalised to sum=1.0 at scoring
 * time):
 *   1. countryRisk        — entity's country of residence (FATF list)
 *   2. pepStatus          — PEP designation drives EDD requirement
 *   3. sanctionsProximity — active sanctions hits on the entity or
 *                           related parties
 *   4. amlAlerts          — open AML alerts weighted by severity
 *   5. txPattern          — velocity threshold breaches
 *   6. kycLevel           — inverse: low KYC tier → higher risk
 *   7. industry           — sector risk weighting (gambling, MSB,
 *                           precious metals, etc.)
 *
 * Risk levels:
 *   0–25   low
 *   26–50  medium
 *   51–75  high
 *   76–100 prohibited
 *
 * The hard gate `requireBelow(entityId, maxScore)` throws
 * `ComplianceError` if the entity's effective risk exceeds the caller's
 * tolerance.
 */
import { nowTs } from '@/kernel/support';
import {
  ComplianceError,
  HIGH_RISK_COUNTRIES,
  INDUSTRY_RISK_WEIGHT,
  RISK_SCORE_TTL_MS,
  type EntityType,
  type RiskFactor,
  type RiskLevel,
  type RiskScore,
} from './types';
import { kycService } from './kyc';
import { pepService } from './pep';
import { sanctionsService } from './sanctions';
import { amlService } from './aml';
import { velocityService } from './velocity';

/** Default factor weights (will be normalised to sum=1 at scoring). */
export const DEFAULT_FACTOR_WEIGHTS: Record<string, number> = {
  countryRisk: 0.20,
  pepStatus: 0.15,
  sanctionsProximity: 0.25,
  amlAlerts: 0.20,
  txPattern: 0.10,
  kycLevel: 0.05,
  industry: 0.05,
};

/** Risk-level thresholds. */
export const RISK_LEVEL_THRESHOLDS: { max: number; level: RiskLevel }[] = [
  { max: 25, level: 'low' },
  { max: 50, level: 'medium' },
  { max: 75, level: 'high' },
  { max: 100, level: 'prohibited' },
];

/** Input for `assessRisk`. */
export interface AssessRiskInput {
  entityId: string;
  country: string;
  entityType?: EntityType;
  industry?: string;
  /** Override weights (else defaults used). */
  weights?: Record<string, number>;
}

/** Result of `assessRisk`. */
export interface AssessRiskResult {
  score: RiskScore;
  fresh: boolean; // false if returned from cache
}

export class RiskScoringService {
  private cache = new Map<string, RiskScore>();
  private weights: Record<string, number> = { ...DEFAULT_FACTOR_WEIGHTS };

  // ------------------------------------------------------- configureWeights
  configureWeights(weights: Record<string, number>): void {
    this.weights = { ...weights };
  }

  // ------------------------------------------------------- assessRisk
  assessRisk(input: AssessRiskInput): AssessRiskResult {
    const cached = this.cache.get(input.entityId);
    if (cached && cached.expiresAt > Date.now()) {
      return { score: cached, fresh: false };
    }

    const weights = input.weights ?? this.weights;
    const normalised = normaliseWeights(weights);

    const factors: RiskFactor[] = [];
    factors.push(this.factorCountryRisk(input.country, normalised));
    factors.push(this.factorPEP(input.entityId, normalised));
    factors.push(this.factorSanctions(input.entityId, normalised));
    factors.push(this.factorAML(input.entityId, normalised));
    factors.push(this.factorTxPattern(input.entityId, input.entityType, normalised));
    factors.push(this.factorKYC(input.entityId, normalised));
    factors.push(this.factorIndustry(input.industry, normalised));

    const score = Math.min(100, Math.max(0, Math.round(factors.reduce((s, f) => s + f.contribution, 0))));
    const level = levelForScore(score);
    const assessedAt = Date.now();

    const result: RiskScore = {
      entityId: input.entityId,
      score,
      level,
      factors,
      assessedAt,
      expiresAt: assessedAt + RISK_SCORE_TTL_MS,
    };
    this.cache.set(input.entityId, result);
    return { score: result, fresh: true };
  }

  // ------------------------------------------------------- getScore
  getScore(entityId: string): RiskScore | undefined {
    const cached = this.cache.get(entityId);
    if (!cached) return undefined;
    if (cached.expiresAt <= Date.now()) return undefined;
    return cached;
  }

  /** Force-clear cached score (forces re-assessment on next call). */
  invalidate(entityId: string): void {
    this.cache.delete(entityId);
  }

  // ------------------------------------------------------- requireBelow
  /**
   * Hard gate: throws `ComplianceError` if the entity's effective risk
   * score is greater than `maxScore`. Re-assesses if the cached score
   * has expired.
   */
  requireBelow(
    entityId: string,
    maxScore: number,
    context: { country: string; entityType?: EntityType; industry?: string },
  ): void {
    let score = this.getScore(entityId);
    if (!score) {
      const result = this.assessRisk({
        entityId,
        country: context.country,
        entityType: context.entityType,
        industry: context.industry,
      });
      score = result.score;
    }
    if (score.score > maxScore) {
      throw new ComplianceError(
        'risk.too_high',
        `Entity ${entityId} risk score ${score.score} (${score.level}) exceeds max ${maxScore}`,
        { entityId, score: score.score, level: score.level, maxScore },
      );
    }
    if (score.level === 'prohibited') {
      throw new ComplianceError(
        'risk.prohibited',
        `Entity ${entityId} is on the prohibited risk list (score ${score.score})`,
        { entityId, score: score.score },
      );
    }
  }

  // ------------------------------------------------------- factor builders
  private factorCountryRisk(country: string, w: Record<string, number>): RiskFactor {
    const isHighRisk = HIGH_RISK_COUNTRIES.includes(country);
    const raw = isHighRisk ? 100 : 20;
    const contribution = raw * (w.countryRisk ?? 0);
    return {
      factor: 'countryRisk',
      weight: w.countryRisk ?? 0,
      contribution,
      rationale: isHighRisk ? `${country} is FATF high-risk` : `${country} standard risk`,
    };
  }

  private factorPEP(entityId: string, w: Record<string, number>): RiskFactor {
    const status = pepService.getPEPStatus(entityId);
    const isPEP = status?.isPEP ?? false;
    const raw = isPEP ? 80 : 5;
    const contribution = raw * (w.pepStatus ?? 0);
    return {
      factor: 'pepStatus',
      weight: w.pepStatus ?? 0,
      contribution,
      rationale: isPEP ? `PEP detected (${status?.pepType})` : 'Not a PEP',
    };
  }

  private factorSanctions(entityId: string, w: Record<string, number>): RiskFactor {
    const hits = sanctionsService.getHits(entityId).filter((h) => !h.isFalsePositive);
    const raw = hits.length > 0 ? 100 : 0;
    const contribution = raw * (w.sanctionsProximity ?? 0);
    return {
      factor: 'sanctionsProximity',
      weight: w.sanctionsProximity ?? 0,
      contribution,
      rationale: hits.length > 0 ? `${hits.length} active sanctions hit(s)` : 'No active hits',
    };
  }

  private factorAML(entityId: string, w: Record<string, number>): RiskFactor {
    const amlScore = amlService.scoreEntity(entityId);
    const contribution = amlScore * (w.amlAlerts ?? 0);
    return {
      factor: 'amlAlerts',
      weight: w.amlAlerts ?? 0,
      contribution,
      rationale: `Aggregate AML alert score ${amlScore}`,
    };
  }

  private factorTxPattern(entityId: string, entityType: EntityType | undefined, w: Record<string, number>): RiskFactor {
    const breaches = velocityService.checkThresholds(entityId);
    const raw = breaches.length === 0 ? 5 : Math.min(100, breaches.length * 30);
    const contribution = raw * (w.txPattern ?? 0);
    return {
      factor: 'txPattern',
      weight: w.txPattern ?? 0,
      contribution,
      rationale: breaches.length === 0
        ? 'No velocity breaches'
        : `${breaches.length} velocity threshold breach(es)`,
    };
  }

  private factorKYC(entityId: string, w: Record<string, number>): RiskFactor {
    const level = kycService.getKYCLevel(entityId);
    // Inverse: low KYC level → higher risk.
    const raw = [80, 40, 15, 5][level] ?? 80;
    const contribution = raw * (w.kycLevel ?? 0);
    return {
      factor: 'kycLevel',
      weight: w.kycLevel ?? 0,
      contribution,
      rationale: `KYC level ${level}`,
    };
  }

  private factorIndustry(industry: string | undefined, w: Record<string, number>): RiskFactor {
    const weight = industry ? INDUSTRY_RISK_WEIGHT[industry] ?? 20 : 20;
    const contribution = weight * (w.industry ?? 0);
    return {
      factor: 'industry',
      weight: w.industry ?? 0,
      contribution,
      rationale: industry ? `Industry: ${industry}` : 'Industry unspecified',
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseWeights(weights: Record<string, number>): Record<string, number> {
  const sum = Object.values(weights).reduce((s, w) => s + Math.max(0, w), 0);
  if (sum === 0) return weights;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(weights)) out[k] = Math.max(0, v) / sum;
  return out;
}

export function levelForScore(score: number): RiskLevel {
  for (const t of RISK_LEVEL_THRESHOLDS) {
    if (score <= t.max) return t.level;
  }
  return 'prohibited';
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForRiskScoring = globalThis as unknown as { __PAYSWAP_RISK_SCORING_SERVICE?: RiskScoringService };
export const riskScoringService =
  _globalForRiskScoring.__PAYSWAP_RISK_SCORING_SERVICE ?? new RiskScoringService();
if (!_globalForRiskScoring.__PAYSWAP_RISK_SCORING_SERVICE) {
  _globalForRiskScoring.__PAYSWAP_RISK_SCORING_SERVICE = riskScoringService;
}
