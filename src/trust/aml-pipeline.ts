/**
 * AML Pipeline — CANONICAL AML transaction monitoring stack. (M-TRUST-40, P3-4 / H-8 fix.)
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  CANONICAL COMPLIANCE STACK — this module is the single source of     ║
 * ║  truth for AML alerting in PaySwap. The legacy in-memory stack at     ║
 * ║  `src/protocol/compliance/aml.ts` is now a thin wrapper that          ║
 * ║  delegates persistence to THIS module.                               ║
 * ║                                                                       ║
 * ║  DO NOT extend the legacy stack directly. New AML-related code        ║
 * ║  should import from `@/trust/aml-pipeline` (here) or `@/trust`        ║
 * ║  (the index).                                                         ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Evaluates every transaction against a set of AML rules. When a rule
 * matches, an AML alert is generated. Rules can: flag, block, review,
 * or report (auto-file SAR).
 *
 * Persistence: alerts are written to the `AMLAlert` Prisma table
 * (`persistAlert()`), so they survive a process restart. The legacy
 * `src/protocol/compliance/aml.ts` wrapper kept alerts in an in-memory
 * `Map` — that process-local state is GONE for any code path that
 * reaches the canonical stack.
 *
 * The pipeline is extensible — plugins can register custom rules via
 * the Capability SDK.
 */

import type { AMLRule, AMLAlertRecord, TransactionContext } from './types';
import { db } from '@/lib/db';
import { uid } from '@/runtime/types';

const REPORTING_THRESHOLD = 10000; // $10k

/**
 * Built-in AML rules.
 */
export const BUILTIN_AML_RULES: AMLRule[] = [
  {
    id: 'structuring',
    name: 'Structuring Detection',
    description: 'Multiple transactions just under the $10k reporting threshold',
    severity: 'high',
    action: 'review',
    evaluate(tx: TransactionContext): boolean {
      const nearThreshold = tx.recentTransactions.filter(
        (t) => t.amount >= REPORTING_THRESHOLD * 0.8 && t.amount < REPORTING_THRESHOLD,
      );
      return nearThreshold.length >= 3;
    },
    explain(tx: TransactionContext): string {
      const nearThreshold = tx.recentTransactions.filter(
        (t) => t.amount >= REPORTING_THRESHOLD * 0.8 && t.amount < REPORTING_THRESHOLD,
      );
      return `${nearThreshold.length} transactions just under $10k in recent history (possible structuring to avoid reporting)`;
    },
  },
  {
    id: 'high_velocity',
    name: 'High Velocity',
    description: 'Unusually high transaction frequency',
    severity: 'medium',
    action: 'flag',
    evaluate(tx: TransactionContext): boolean {
      const lastHour = tx.recentTransactions.filter(
        (t) => t.timestamp > tx.timestamp - 60 * 60 * 1000,
      );
      return lastHour.length >= 50;
    },
    explain(tx: TransactionContext): string {
      const lastHour = tx.recentTransactions.filter(
        (t) => t.timestamp > tx.timestamp - 60 * 60 * 1000,
      );
      return `${lastHour.length} transactions in the last hour (velocity threshold: 50/hour)`;
    },
  },
  {
    id: 'large_amount',
    name: 'Large Transaction',
    description: 'Transaction exceeds $50,000',
    severity: 'medium',
    action: 'review',
    evaluate(tx: TransactionContext): boolean {
      return tx.amount >= 50000;
    },
    explain(tx: TransactionContext): string {
      return `Transaction amount ${tx.amount} ${tx.currency} exceeds $50k review threshold`;
    },
  },
  {
    id: 'high_risk_jurisdiction',
    name: 'High-Risk Jurisdiction',
    description: 'Transaction involves a high-risk country (OFAC sanctioned)',
    severity: 'critical',
    action: 'block',
    evaluate(tx: TransactionContext): boolean {
      const highRisk = new Set(['IR', 'KP', 'SY', 'CU', 'VE', 'MM', 'AF']);
      return highRisk.has(tx.sourceCountry) || highRisk.has(tx.destCountry);
    },
    explain(tx: TransactionContext): string {
      return `Transaction involves high-risk jurisdiction (source: ${tx.sourceCountry}, dest: ${tx.destCountry})`;
    },
  },
  {
    id: 'pep_exposure',
    name: 'PEP Exposure',
    description: 'Entity is a Politically Exposed Person',
    severity: 'high',
    action: 'review',
    evaluate(tx: TransactionContext): boolean {
      return tx.isPEP;
    },
    explain(): string {
      return 'Entity is flagged as a Politically Exposed Person — enhanced due diligence required';
    },
  },
  {
    id: 'unverified_kyc',
    name: 'Unverified KYC',
    description: 'Transaction from entity without completed KYC',
    severity: 'medium',
    action: 'flag',
    evaluate(tx: TransactionContext): boolean {
      return tx.kycStatus === 'none' || tx.kycStatus === 'rejected';
    },
    explain(tx: TransactionContext): string {
      return `Entity KYC status is "${tx.kycStatus}" — verification required`;
    },
  },
  {
    id: 'new_account_large_txn',
    name: 'New Account Large Transaction',
    description: 'Large transaction from a new account (<7 days old)',
    severity: 'high',
    action: 'review',
    evaluate(tx: TransactionContext): boolean {
      return tx.entityAgeDays < 7 && tx.amount >= 5000;
    },
    explain(tx: TransactionContext): string {
      return `Large transaction (${tx.amount} ${tx.currency}) from a new account (${tx.entityAgeDays} days old)`;
    },
  },
  {
    id: 'round_amount',
    name: 'Round Amount Pattern',
    description: 'Multiple round-number transactions (possible money laundering)',
    severity: 'low',
    action: 'flag',
    evaluate(tx: TransactionContext): boolean {
      const roundTxns = tx.recentTransactions.filter(
        (t) => t.amount % 1000 === 0 && t.amount >= 1000,
      );
      return roundTxns.length >= 5;
    },
    explain(tx: TransactionContext): string {
      const roundTxns = tx.recentTransactions.filter(
        (t) => t.amount % 1000 === 0 && t.amount >= 1000,
      );
      return `${roundTxns.length} round-number transactions in recent history`;
    },
  },
  {
    id: 'off_hours',
    name: 'Off-Hours Activity',
    description: 'Transaction outside normal business hours',
    severity: 'low',
    action: 'flag',
    evaluate(tx: TransactionContext): boolean {
      const hour = new Date(tx.timestamp).getHours();
      return hour < 6 || hour >= 22;
    },
    explain(tx: TransactionContext): string {
      const hour = new Date(tx.timestamp).getHours();
      return `Transaction at ${hour}:00 (off-hours: 22:00-06:00)`;
    },
  },
  {
    id: 'rapid_movement',
    name: 'Rapid Movement',
    description: 'Funds received then quickly sent (pass-through pattern)',
    severity: 'high',
    action: 'review',
    evaluate(tx: TransactionContext): boolean {
      // Check if there were incoming transactions in the last 2h followed by this outgoing
      const recentIncoming = tx.recentTransactions.filter(
        (t) => t.timestamp > tx.timestamp - 2 * 60 * 60 * 1000 && t.destCountry === tx.sourceCountry,
      );
      return recentIncoming.length >= 2 && tx.amount > 1000;
    },
    explain(tx: TransactionContext): string {
      return 'Rapid pass-through pattern: funds received and quickly sent';
    },
  },
];

export class AMLPipeline {
  private rules: Map<string, AMLRule> = new Map();
  private alerts: Map<string, AMLAlertRecord> = new Map();

  constructor() {
    // Register built-in rules
    for (const rule of BUILTIN_AML_RULES) {
      this.rules.set(rule.id, rule);
    }
  }

  /**
   * Register a custom AML rule (used by plugins).
   */
  registerRule(rule: AMLRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * List all registered rules.
   */
  listRules(): AMLRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Evaluate a transaction against all rules.
   * Returns the alerts generated.
   */
  evaluate(tx: TransactionContext): AMLAlertRecord[] {
    const generated: AMLAlertRecord[] = [];

    for (const rule of this.rules.values()) {
      try {
        if (rule.evaluate(tx)) {
          const alert: AMLAlertRecord = {
            id: uid('aml'),
            ruleId: rule.id,
            ruleName: rule.name,
            entityId: tx.entityId,
            entityType: tx.entityType,
            severity: rule.severity,
            action: rule.action,
            status: 'open',
            description: rule.explain(tx),
            evidence: [
              {
                transactionId: tx.transactionId,
                amount: tx.amount,
                currency: tx.currency,
                sourceCountry: tx.sourceCountry,
                destCountry: tx.destCountry,
                timestamp: tx.timestamp,
                entityAgeDays: tx.entityAgeDays,
                kycStatus: tx.kycStatus,
              },
            ],
            transactionId: tx.transactionId,
            createdAt: Date.now(),
          };
          this.alerts.set(alert.id, alert);
          generated.push(alert);
        }
      } catch (err) {
        console.error(`[AML] Rule ${rule.id} threw:`, err);
      }
    }

    return generated;
  }

  /**
   * Persist an alert to the database.
   */
  async persistAlert(alert: AMLAlertRecord): Promise<void> {
    try {
      await db.aMLAlert.create({
        data: {
          id: alert.id,
          entityType: alert.entityType,
          entityId: alert.entityId,
          alertType: alert.ruleId.toUpperCase(),
          severity: alert.severity.toUpperCase(),
          score: alert.riskScore ?? 50,
          details: JSON.stringify(alert.evidence),
          status: alert.status.toUpperCase(),
          environment: 'sandbox',
        },
      });
    } catch (err) {
      console.error('[AML] Failed to persist alert:', err);
    }
  }

  /**
   * List alerts (from DB).
   */
  async listAlerts(filter?: {
    status?: string;
    severity?: string;
    entityId?: string;
    limit?: number;
  }): Promise<AMLAlertRecord[]> {
    try {
      const where: Record<string, unknown> = {};
      if (filter?.status) where.status = filter.status.toUpperCase();
      if (filter?.severity) where.severity = filter.severity.toUpperCase();
      if (filter?.entityId) where.entityId = filter.entityId;

      const rows = await db.aMLAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter?.limit ?? 100,
      });

      return rows.map((r) => ({
        id: r.id,
        ruleId: r.alertType.toLowerCase(),
        ruleName: r.alertType,
        entityId: r.entityId,
        entityType: r.entityType as AMLAlertRecord['entityType'],
        severity: r.severity.toLowerCase() as AMLAlertRecord['severity'],
        action: 'review' as const,
        status: r.status.toLowerCase() as AMLAlertRecord['status'],
        description: r.details || 'AML alert',
        evidence: [],
        riskScore: r.score,
        assignedTo: r.assignedTo ?? undefined,
        createdAt: r.createdAt.getTime(),
        resolvedAt: r.closedAt?.getTime(),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Update alert status.
   */
  async updateStatus(
    alertId: string,
    status: AMLAlertRecord['status'],
    resolution?: string,
  ): Promise<void> {
    try {
      await db.aMLAlert.update({
        where: { id: alertId },
        data: {
          status: status.toUpperCase(),
          closedAt: status === 'closed' || status === 'sar_filed' ? new Date() : undefined,
        },
      });

      // Update in-memory
      const alert = this.alerts.get(alertId);
      if (alert) {
        alert.status = status;
        alert.resolvedAt = Date.now();
        alert.resolution = resolution;
      }
    } catch (err) {
      console.error('[AML] Failed to update alert:', err);
    }
  }
  /**
   * Get a single alert by ID.
   */
  async getAlert(alertId: string): Promise<AMLAlertRecord | null> {
    try {
      const r = await db.aMLAlert.findUnique({ where: { id: alertId } });
      if (!r) return null;
      return {
        id: r.id,
        ruleId: r.alertType.toLowerCase(),
        ruleName: r.alertType,
        entityId: r.entityId,
        entityType: r.entityType as AMLAlertRecord['entityType'],
        severity: r.severity.toLowerCase() as AMLAlertRecord['severity'],
        action: 'review' as const,
        status: r.status.toLowerCase() as AMLAlertRecord['status'],
        description: r.details || 'AML alert',
        evidence: [],
        riskScore: r.score,
        assignedTo: r.assignedTo ?? undefined,
        createdAt: r.createdAt.getTime(),
        resolvedAt: r.closedAt?.getTime(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Update alert status (alias for updateStatus).
   */
  async updateAlertStatus(
    alertId: string,
    status: AMLAlertRecord['status'],
    resolution?: string,
  ): Promise<void> {
    return this.updateStatus(alertId, status, resolution);
  }

  /**
   * Get alert stats.
   */
  async getStats(): Promise<{
    total: number;
    open: number;
    investigating: number;
    escalated: number;
    closed: number;
    bySeverity: Record<string, number>;
  }> {
    try {
      const alerts = await db.aMLAlert.findMany();
      return {
        total: alerts.length,
        open: alerts.filter((a) => a.status === 'OPEN').length,
        investigating: alerts.filter((a) => a.status === 'INVESTIGATING').length,
        escalated: alerts.filter((a) => a.status === 'ESCALATED').length,
        closed: alerts.filter((a) => a.status === 'CLOSED').length,
        bySeverity: {
          LOW: alerts.filter((a) => a.severity === 'LOW').length,
          MEDIUM: alerts.filter((a) => a.severity === 'MEDIUM').length,
          HIGH: alerts.filter((a) => a.severity === 'HIGH').length,
          CRITICAL: alerts.filter((a) => a.severity === 'CRITICAL').length,
        },
      };
    } catch {
      return { total: 0, open: 0, investigating: 0, escalated: 0, closed: 0, bySeverity: {} };
    }
  }
}

export const amlPipeline = new AMLPipeline();
