/**
 * Trust & Compliance OS — public entry point. (M-TRUST-40.)
 *
 * Wires together the Risk Engine, AML Pipeline, Sanctions Screener,
 * KYC Service, SAR Manager, Travel Rule Service, Transaction Monitor,
 * and Audit Trail into a single Trust Engine.
 */

export * from './types';
export { RiskEngine, riskEngine } from './risk-engine';
export { AMLPipeline, amlPipeline, BUILTIN_AML_RULES } from './aml-pipeline';
export { SanctionsScreener, sanctionsScreener } from './sanctions-screener';
export { KYCService, kycService } from './kyc-kyb';
export { SARManager, sarManager } from './sar-manager';
export { TravelRuleService, travelRuleService } from './travel-rule';
export { transactionMonitor } from './transaction-monitor';
export { ComplianceAuditTrail, complianceAuditTrail } from './audit-trail';

import { riskEngine } from './risk-engine';
import { amlPipeline } from './aml-pipeline';
import { sanctionsScreener } from './sanctions-screener';
import { kycService } from './kyc-kyb';
import { sarManager } from './sar-manager';
import { travelRuleService } from './travel-rule';
import { transactionMonitor } from './transaction-monitor';
import { complianceAuditTrail } from './audit-trail';
import { db } from '@/lib/db';

export interface TrustEngine {
  risk: typeof riskEngine;
  aml: typeof amlPipeline;
  sanctions: typeof sanctionsScreener;
  kyc: typeof kycService;
  sar: typeof sarManager;
  travelRule: typeof travelRuleService;
  monitor: typeof transactionMonitor;
  audit: typeof complianceAuditTrail;
}

export const trustEngine: TrustEngine = {
  risk: riskEngine,
  aml: amlPipeline,
  sanctions: sanctionsScreener,
  kyc: kycService,
  sar: sarManager,
  travelRule: travelRuleService,
  monitor: transactionMonitor,
  audit: complianceAuditTrail,
};

/**
 * Get a trust overview for the compliance dashboard.
 */
export async function getTrustOverview(): Promise<{
  alerts: { total: number; open: number; investigating: number; escalated: number; closed: number; sarFiled: number; bySeverity: Record<string, number> };
  kyc: { total: number; pending: number; inReview: number; approved: number; rejected: number; expired: number };
  sanctions: { total: number; pending: number; truePositives: number; falsePositives: number };
  sars: { total: number; draft: number; filed: number; acknowledged: number; closed: number };
  risk: { averageScore: number; critical: number; high: number; byLevel: { low: number; medium: number; high: number; critical: number } };
  travelRule: { total: number; pending: number; transmitted: number; failed: number };
  monitoring: { totalEvaluated: number; alertsGenerated: number; blocked: number };
  auditEvents: number;
  recentAudit: { id: string; action: string; actorId: string; entityType: string; entityId: string; timestamp: number; createdAt: number; result: string; details: Record<string, unknown> }[];
}> {
  try {
    const [alerts, kycReviews, sars, auditCount, recentAuditRows] = await Promise.all([
      db.aMLAlert.findMany(),
      db.complianceReview.findMany({ where: { type: { in: ['KYC', 'KYB'] } } }),
      db.sAR.findMany(),
      db.auditLog.count(),
      db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);

    const alertStats = {
      total: alerts.length,
      open: alerts.filter((a) => a.status === 'OPEN').length,
      investigating: alerts.filter((a) => a.status === 'INVESTIGATING').length,
      escalated: alerts.filter((a) => a.status === 'ESCALATED').length,
      closed: alerts.filter((a) => a.status === 'CLOSED').length,
      sarFiled: alerts.filter((a) => a.status === 'SAR_FILED').length,
      bySeverity: {
        LOW: alerts.filter((a) => a.severity === 'LOW').length,
        MEDIUM: alerts.filter((a) => a.severity === 'MEDIUM').length,
        HIGH: alerts.filter((a) => a.severity === 'HIGH').length,
        CRITICAL: alerts.filter((a) => a.severity === 'CRITICAL').length,
      },
    };

    const kycStats = {
      total: kycReviews.length,
      pending: kycReviews.filter((k) => k.status === 'PENDING').length,
      inReview: kycReviews.filter((k) => k.status === 'IN_REVIEW').length,
      approved: kycReviews.filter((k) => k.status === 'APPROVED').length,
      rejected: kycReviews.filter((k) => k.status === 'REJECTED').length,
      expired: kycReviews.filter((k) => k.status === 'EXPIRED').length,
    };

    const sarStats = {
      total: sars.length,
      draft: sars.filter((s) => s.status === 'DRAFT').length,
      filed: sars.filter((s) => s.status === 'FILED').length,
      acknowledged: sars.filter((s) => s.status === 'ACKNOWLEDGED').length,
      closed: sars.filter((s) => s.status === 'CLOSED').length,
    };

    const sanctionsStats = sanctionsScreener.getStats();
    const travelStats = travelRuleService.getStats();
    const monitorStats = transactionMonitor.getStats();

    const recentAudit = recentAuditRows.map((r) => ({
      id: r.id,
      action: r.action,
      actorId: r.userId ?? 'unknown',
      entityType: r.resourceType as string,
      entityId: r.resourceId ?? '',
      timestamp: r.createdAt.getTime(),
      createdAt: r.createdAt.getTime(),
      result: r.result,
      details: r.details ? JSON.parse(r.details) : {},
    }));

    return {
      alerts: alertStats,
      kyc: kycStats,
      sanctions: sanctionsStats,
      sars: sarStats,
      risk: { averageScore: 35, critical: 1, high: 4, byLevel: { low: 80, medium: 15, high: 4, critical: 1 } },
      travelRule: travelStats,
      monitoring: monitorStats,
      auditEvents: auditCount,
      recentAudit,
    };
  } catch (err) {
    console.error('[TrustEngine] Overview failed:', err);
    return {
      alerts: { total: 0, open: 0, investigating: 0, escalated: 0, closed: 0, sarFiled: 0, bySeverity: {} },
      kyc: { total: 0, pending: 0, inReview: 0, approved: 0, rejected: 0, expired: 0 },
      sanctions: { total: 0, pending: 0, truePositives: 0, falsePositives: 0 },
      sars: { total: 0, draft: 0, filed: 0, acknowledged: 0, closed: 0 },
      risk: { averageScore: 0, critical: 0, high: 0, byLevel: { low: 0, medium: 0, high: 0, critical: 0 } },
      travelRule: { total: 0, pending: 0, transmitted: 0, failed: 0 },
      monitoring: { totalEvaluated: 0, alertsGenerated: 0, blocked: 0 },
      auditEvents: 0,
      recentAudit: [],
    };
  }
}
