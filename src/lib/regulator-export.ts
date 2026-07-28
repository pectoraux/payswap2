/**
 * Regulator Export — generates compliance reports for regulators. (Regulatory.)
 *
 * Produces structured exports for:
 *   - AML transaction monitoring (Suspicious Activity Reports)
 *   - Travel rule compliance (cross-border transaction data)
 *   - Proof of reserves
 *   - Audit trail (immutable log of all financial actions)
 *
 * Exports are in JSON format (easily consumable by regulator systems)
 * and can be cryptographically signed for authenticity.
 */

import { db } from '@/lib/db';
import { proofOfReservesService } from './proof-of-reserves';
import { createHash, createSign } from 'crypto';
import { logger } from './logger';

export interface RegulatorExport {
  exportId: string;
  type: 'aml' | 'travel_rule' | 'proof_of_reserves' | 'audit_trail' | 'full';
  period: {
    from: number;
    to: number;
  };
  generatedAt: number;
  data: unknown;
  hash: string;
  signature?: string;
}

class RegulatorExportService {
  /**
   * Generate a full compliance export (all report types).
   */
  async generateFullExport(from: Date, to: Date): Promise<RegulatorExport> {
    const [aml, travelRule, por, audit] = await Promise.all([
      this.generateAMLExport(from, to),
      this.generateTravelRuleExport(from, to),
      this.generateProofOfReservesExport(),
      this.generateAuditTrailExport(from, to),
    ]);

    const data = { aml, travelRule, proofOfReserves: por, auditTrail: audit };
    return this.buildExport('full', from.getTime(), to.getTime(), data);
  }

  /**
   * Generate AML transaction monitoring report.
   */
  async generateAMLExport(from: Date, to: Date): Promise<RegulatorExport> {
    const alerts = await db.aMLAlert.findMany({
      where: {
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: 'asc' },
    });

    const sars = await db.sAR.findMany({
      where: {
        createdAt: { gte: from, lte: to },
      },
    });

    const data = {
      alerts: alerts.map(a => ({
        id: a.id,
        type: a.alertType,
        severity: a.severity,
        status: a.status,
        entityId: a.entityId,
        entityType: a.entityType,
        score: Number(a.score),
        createdAt: a.createdAt.toISOString(),
        closedAt: a.closedAt?.toISOString(),
      })),
      sars: sars.map(s => ({
        id: s.id,
        status: s.status,
        amount: Number(s.amount),
        narrative: s.narrative,
        filedAt: s.filedAt?.toISOString(),
        regulatoryRef: s.regulatoryRef,
      })),
      summary: {
        totalAlerts: alerts.length,
        openAlerts: alerts.filter(a => a.status === 'OPEN').length,
        escalatedAlerts: alerts.filter(a => a.status === 'ESCALATED').length,
        sarsFiled: sars.filter(s => s.status === 'FILED').length,
      },
    };

    return this.buildExport('aml', from.getTime(), to.getTime(), data);
  }

  /**
   * Generate Travel Rule compliance report.
   */
  async generateTravelRuleExport(from: Date, to: Date): Promise<RegulatorExport> {
    // Cross-border payments above the $1,000 threshold
    const payments = await db.payment.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        amount: { gte: 1000 },
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        sourceCurrency: true,
        destinationCurrency: true,
        method: true,
        status: true,
        reference: true,
        createdAt: true,
      },
    });

    // Filter to cross-border (source != destination currency)
    const crossBorder = payments.filter(p => p.sourceCurrency !== p.destinationCurrency);

    const data = {
      transactions: crossBorder.map(p => ({
        transactionId: p.id,
        amount: Number(p.amount),
        currency: p.currency,
        sourceCurrency: p.sourceCurrency,
        destinationCurrency: p.destinationCurrency,
        method: p.method,
        status: p.status,
        reference: p.reference,
        timestamp: p.createdAt.toISOString(),
        // Travel rule requires originator + beneficiary info
        // (in production, this would include name, account, address)
        travelRuleRequired: true,
      })),
      summary: {
        totalTransactions: crossBorder.length,
        totalVolume: crossBorder.reduce((s, p) => s + Number(p.amount), 0),
      },
    };

    return this.buildExport('travel_rule', from.getTime(), to.getTime(), data);
  }

  /**
   * Generate proof of reserves report.
   */
  async generateProofOfReservesExport(): Promise<RegulatorExport> {
    const por = await proofOfReservesService.generate();
    return this.buildExport('proof_of_reserves', 0, Date.now(), por);
  }

  /**
   * Generate audit trail export.
   */
  async generateAuditTrailExport(from: Date, to: Date): Promise<RegulatorExport> {
    const logs = await db.auditLog.findMany({
      where: {
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: 'asc' },
      take: 10_000, // cap for performance
    });

    const data = {
      entries: logs.map(l => ({
        id: l.id,
        userId: l.userId,
        action: l.action,
        resourceType: l.resourceType,
        resourceId: l.resourceId,
        result: l.result,
        timestamp: l.createdAt.toISOString(),
        details: l.details ? JSON.parse(l.details) : null,
      })),
      summary: {
        totalEntries: logs.length,
        successCount: logs.filter(l => l.result === 'SUCCESS').length,
        deniedCount: logs.filter(l => l.result === 'DENIED').length,
        errorCount: logs.filter(l => l.result === 'ERROR').length,
      },
    };

    return this.buildExport('audit_trail', from.getTime(), to.getTime(), data);
  }

  /**
   * Build a regulator export with hash and optional signature.
   */
  private buildExport(
    type: RegulatorExport['type'],
    from: number,
    to: number,
    data: unknown,
  ): RegulatorExport {
    const exportId = `exp_${type}_${Date.now()}`;
    const generatedAt = Date.now();

    // Hash the data for integrity verification
    const hash = createHash('sha256')
      .update(JSON.stringify({ exportId, type, from, to, generatedAt, data }))
      .digest('hex');

    // Sign with the server's private key (if available)
    let signature: string | undefined;
    const privateKey = process.env.REGULATOR_SIGNING_KEY;
    if (privateKey) {
      try {
        const sign = createSign('SHA256');
        sign.update(hash);
        signature = sign.sign(privateKey, 'hex');
      } catch (err) {
        logger.warn('Failed to sign regulator export', { error: err });
      }
    }

    logger.info('Regulator export generated', { exportId, type, hash: hash.slice(0, 16) });

    return {
      exportId,
      type,
      period: { from, to },
      generatedAt,
      data,
      hash,
      signature,
    };
  }
}

export const regulatorExportService = new RegulatorExportService();
