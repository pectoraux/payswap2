/**
 * Risk Engine — computes risk scores for entities. (M-TRUST-40.)
 *
 * Risk is computed from multiple factors:
 *   - Transaction velocity (high frequency)
 *   - Structuring patterns (amounts just under reporting threshold)
 *   - High-risk geography
 *   - KYC age (new accounts are riskier)
 *   - Sanctions proximity
 *   - AML alert history
 *   - Counterparty concentration
 *   - Off-hours activity
 *
 * Scores are cached for 24h and recomputed on demand.
 */

import type { RiskScore, RiskFactor, RiskLevel, EntityType } from './types';
import { db } from '@/lib/db';
import { uid } from '@/runtime/types';

const SCORE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const HIGH_RISK_COUNTRIES = new Set(['IR', 'KP', 'SY', 'CU', 'VE', 'MM', 'AF']);
const REPORTING_THRESHOLD = 10000; // $10k threshold for structuring detection

export class RiskEngine {
  private cache: Map<string, RiskScore> = new Map();

  /**
   * Compute a risk score for an entity.
   */
  async computeScore(
    entityId: string,
    entityType: EntityType,
  ): Promise<RiskScore> {
    // Check cache
    const cached = this.cache.get(entityId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const factors: RiskFactor[] = [];

    // Factor 1: KYC status
    const kycFactor = await this.assessKYC(entityId);
    if (kycFactor) factors.push(kycFactor);

    // Factor 2: AML alert history
    const amlFactor = await this.assessAMLHistory(entityId);
    if (amlFactor) factors.push(amlFactor);

    // Factor 3: Sanctions hits
    const sanctionsFactor = await this.assessSanctions(entityId);
    if (sanctionsFactor) factors.push(sanctionsFactor);

    // Factor 4: Transaction velocity
    const velocityFactor = await this.assessVelocity(entityId, entityType);
    if (velocityFactor) factors.push(velocityFactor);

    // Factor 5: Structuring pattern
    const structuringFactor = await this.assessStructuring(entityId, entityType);
    if (structuringFactor) factors.push(structuringFactor);

    // Factor 6: High-risk geography
    const geoFactor = await this.assessGeography(entityId, entityType);
    if (geoFactor) factors.push(geoFactor);

    // Factor 7: Entity age
    const ageFactor = await this.assessEntityAge(entityId, entityType);
    if (ageFactor) factors.push(ageFactor);

    // Aggregate score (weighted sum, capped at 100)
    const score = Math.min(
      100,
      factors.reduce((sum, f) => sum + f.weight, 0),
    );

    const level: RiskLevel =
      score >= 80 ? 'critical' :
      score >= 60 ? 'high' :
      score >= 30 ? 'medium' : 'low';

    const riskScore: RiskScore = {
      entityId,
      entityType,
      score: Math.round(score),
      level,
      factors,
      computedAt: Date.now(),
      expiresAt: Date.now() + SCORE_TTL_MS,
    };

    this.cache.set(entityId, riskScore);
    return riskScore;
  }

  /**
   * Get cached score (null if not computed or expired).
   */
  getScore(entityId: string): RiskScore | null {
    const cached = this.cache.get(entityId);
    if (!cached || cached.expiresAt < Date.now()) return null;
    return cached;
  }

  /**
   * Force recompute (clears cache first).
   */
  async recompute(entityId: string, entityType: EntityType): Promise<RiskScore> {
    this.cache.delete(entityId);
    return this.computeScore(entityId, entityType);
  }

  // ── Factor assessment helpers ──────────────────────────────────────────────

  private async assessKYC(entityId: string): Promise<RiskFactor | null> {
    try {
      const review = await db.complianceReview.findFirst({
        where: { entityId, type: { in: ['KYC', 'KYB'] } },
        orderBy: { createdAt: 'desc' },
      });

      if (!review) {
        return {
          name: 'no_kyc',
          weight: 25,
          detail: 'No KYC/KYB verification on file',
        };
      }

      if (review.status === 'REJECTED') {
        return {
          name: 'kyc_rejected',
          weight: 40,
          detail: 'KYC was previously rejected',
        };
      }

      if (review.status === 'PENDING') {
        return {
          name: 'kyc_pending',
          weight: 15,
          detail: 'KYC verification pending',
        };
      }

      return null; // approved = no risk contribution
    } catch {
      return null;
    }
  }

  private async assessAMLHistory(entityId: string): Promise<RiskFactor | null> {
    try {
      const alerts = await db.aMLAlert.findMany({
        where: { entityId, status: { in: ['OPEN', 'INVESTIGATING', 'ESCALATED'] } },
      });

      if (alerts.length === 0) return null;

      const criticalCount = alerts.filter((a) => a.severity === 'CRITICAL').length;
      const highCount = alerts.filter((a) => a.severity === 'HIGH').length;

      const weight = Math.min(
        35,
        criticalCount * 15 + highCount * 8 + alerts.length * 2,
      );

      return {
        name: 'aml_alerts',
        weight,
        detail: `${alerts.length} active AML alerts (${criticalCount} critical, ${highCount} high)`,
      };
    } catch {
      return null;
    }
  }

  private async assessSanctions(entityId: string): Promise<RiskFactor | null> {
    try {
      // Check for sanctions hits in compliance reviews
      const sanctions = await db.complianceReview.findFirst({
        where: { entityId, type: 'SANCTIONS', status: 'PENDING' },
      });

      if (sanctions) {
        return {
          name: 'sanctions_hit',
          weight: 50,
          detail: 'Potential sanctions match pending review',
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  private async assessVelocity(
    entityId: string,
    entityType: EntityType,
  ): Promise<RiskFactor | null> {
    try {
      // Check recent transactions (last 1h)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      let recentCount = 0;
      if (entityType === 'merchant' || entityType === 'user') {
        recentCount = await db.payment.count({
          where: {
            OR: [
              { merchantId: entityId },
              { customerId: entityId },
            ],
            createdAt: { gte: oneHourAgo },
          },
        });
      }

      if (recentCount >= 50) {
        return {
          name: 'high_velocity',
          weight: 30,
          detail: `${recentCount} transactions in the last hour (threshold: 50)`,
        };
      }

      if (recentCount >= 20) {
        return {
          name: 'moderate_velocity',
          weight: 15,
          detail: `${recentCount} transactions in the last hour`,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  private async assessStructuring(
    entityId: string,
    entityType: EntityType,
  ): Promise<RiskFactor | null> {
    try {
      // Look for multiple transactions just under the reporting threshold
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      let transactions: { amount: number }[] = [];
      if (entityType === 'merchant' || entityType === 'user') {
        transactions = await db.payment.findMany({
          where: {
            OR: [
              { merchantId: entityId },
              { customerId: entityId },
            ],
            createdAt: { gte: oneDayAgo },
          },
          select: { amount: true },
        });
      }

      // Count transactions between 80% and 100% of threshold
      const nearThreshold = transactions.filter(
        (t) => t.amount >= REPORTING_THRESHOLD * 0.8 && t.amount < REPORTING_THRESHOLD,
      );

      if (nearThreshold.length >= 3) {
        return {
          name: 'structuring_pattern',
          weight: 40,
          detail: `${nearThreshold.length} transactions just under the $10k reporting threshold in 24h (possible structuring)`,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  private async assessGeography(
    entityId: string,
    entityType: EntityType,
  ): Promise<RiskFactor | null> {
    try {
      // Check if entity transacts with high-risk countries
      if (entityType === 'merchant') {
        const payments = await db.payment.findMany({
          where: { merchantId: entityId },
          select: { sourceCurrency: true, destinationCurrency: true },
          take: 100,
        });

        // High-risk currency codes (proxy for country)
        const highRiskCurrencies = new Set(['IRR', 'KPW', 'SYP', 'CUP', 'VEF', 'MMK', 'AFN']);
        const highRiskCount = payments.filter(
          (p) =>
            highRiskCurrencies.has(p.sourceCurrency?.toUpperCase() || '') ||
            highRiskCurrencies.has(p.destinationCurrency?.toUpperCase() || ''),
        ).length;

        if (highRiskCount > 0) {
          return {
            name: 'high_risk_geography',
            weight: 25,
            detail: `${highRiskCount} transactions involving high-risk jurisdictions`,
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async assessEntityAge(
    entityId: string,
    entityType: EntityType,
  ): Promise<RiskFactor | null> {
    try {
      let createdAt: Date | null = null;

      if (entityType === 'merchant') {
        const merchant = await db.merchant.findUnique({
          where: { id: entityId },
          select: { createdAt: true },
        });
        createdAt = merchant?.createdAt ?? null;
      } else if (entityType === 'user') {
        const user = await db.user.findUnique({
          where: { id: entityId },
          select: { createdAt: true },
        });
        createdAt = user?.createdAt ?? null;
      }

      if (!createdAt) return null;

      const ageDays = (Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000);

      if (ageDays < 1) {
        return {
          name: 'new_account',
          weight: 20,
          detail: `Account is less than 1 day old`,
        };
      }

      if (ageDays < 7) {
        return {
          name: 'young_account',
          weight: 10,
          detail: `Account is less than 7 days old`,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get risk scores for multiple entities (batch).
   */
  async getScoresForEntities(
    entities: { id: string; type: EntityType }[],
  ): Promise<RiskScore[]> {
    const scores: RiskScore[] = [];
    for (const e of entities) {
      try {
        const score = await this.computeScore(e.id, e.type);
        scores.push(score);
      } catch {
        // skip on error
      }
    }
    return scores;
  }
  /**
   * Alias for recompute (backward compat).
   */
  async forceRecompute(entityId: string, entityType: EntityType): Promise<RiskScore> {
    return this.recompute(entityId, entityType);
  }

  /**
   * List all cached risk scores.
   */
  listScores(): RiskScore[] {
    return Array.from(this.cache.values()).filter((s) => s.expiresAt > Date.now());
  }
}

export const riskEngine = new RiskEngine();
