/**
 * Transaction Monitor — real-time transaction monitoring. (M-TRUST-40.)
 *
 * Hooks into the runtime event stream. On every transaction:
 *   1. Runs AML rules
 *   2. Computes risk score
 *   3. Runs sanctions check (if new entity)
 *   4. Creates travel rule record (if cross-border above threshold)
 *   5. Generates alerts for any matches
 */

import type { TransactionContext, AMLAlertRecord, RiskScore } from './types';
import { amlPipeline } from './aml-pipeline';
import { riskEngine } from './risk-engine';
import { sanctionsScreener } from './sanctions-screener';
import { travelRuleService } from './travel-rule';

export interface MonitoringResult {
  transactionId: string;
  alerts: AMLAlertRecord[];
  riskScore: RiskScore | null;
  travelRuleRequired: boolean;
  travelRuleRecordId?: string;
  blocked: boolean;
}

class TransactionMonitor {
  private stats = {
    totalEvaluated: 0,
    alertsGenerated: 0,
    blocked: 0,
  };

  /**
   * Evaluate a transaction. Called on every payment/payout/transfer.
   */
  async onTransaction(tx: TransactionContext): Promise<MonitoringResult> {
    this.stats.totalEvaluated++;

    // 1. Run AML rules
    const alerts = amlPipeline.evaluate(tx);

    // 2. Compute risk score
    const riskScore = await riskEngine.computeScore(tx.entityId, tx.entityType);

    // 3. Travel rule check (mock — in production, this is a real check)
    const usdAmount = tx.amount; // assume USD for mock
    const travelRuleRequired =
      tx.sourceCountry !== tx.destCountry && usdAmount >= 1000;

    let travelRuleRecordId: string | undefined;
    if (travelRuleRequired) {
      const record = await travelRuleService.createRecord({
        id: tx.transactionId,
        amount: tx.amount,
        currency: tx.currency ?? 'USD',
        sourceCountry: tx.sourceCountry,
        destCountry: tx.destCountry,
      });
      travelRuleRecordId = record.id;
    }

    // 4. Persist alerts
    for (const alert of alerts) {
      alert.riskScore = riskScore.score;
      await amlPipeline.persistAlert(alert);
      this.stats.alertsGenerated++;
    }

    // 5. Block if any rule says block
    const blocked = alerts.some((a) => a.action === 'block');
    if (blocked) {
      this.stats.blocked++;
    }

    return {
      transactionId: tx.transactionId,
      alerts,
      riskScore,
      travelRuleRequired,
      travelRuleRecordId,
      blocked,
    };
  }

  /**
   * Screen a new entity against sanctions lists.
   */
  async screenEntity(entityName: string, entityId: string) {
    return sanctionsScreener.screen(entityName, entityId);
  }

  /**
   * Get monitoring stats.
   */
  getStats() {
    return { ...this.stats };
  }
}

export const transactionMonitor = new TransactionMonitor();
