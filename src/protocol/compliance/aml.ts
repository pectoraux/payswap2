/**
 * PaySwap Protocol — AML (Anti-Money-Laundering) Monitoring Service.
 * (LEGACY WRAPPER — delegates persistence to `src/trust/aml-pipeline.ts`.)
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  THIN WRAPPER — delegates persistence to the canonical                 ║
 * ║  `src/trust/aml-pipeline.ts` (Prisma-backed).                          ║
 * ║                                                                       ║
 * ║  This module exists ONLY for backwards-compat with existing            ║
 * ║  importers (risk-scoring, sar, audit-export, compliance/status,        ║
 * ║  certification/run). New code should import from                       ║
 * ║  `@/trust/aml-pipeline` (the canonical stack).                        ║
 * ║                                                                       ║
 * ║  DO NOT extend this wrapper directly. New AML-related code goes        ║
 * ║  in `src/trust/`.                                                     ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Responsibilities:
 *  - `monitorTransaction(tx)` runs every transaction through four checks:
 *      1. Structuring detection — multiple tx just below the $10k
 *         reporting threshold within 24h.
 *      2. Velocity monitoring — threshold breaches surfaced by
 *         `velocityService`.
 *      3. High-risk corridor detection — known country pairs flagged
 *         via `HIGH_RISK_CORRIDORS`.
 *      4. Unusual-pattern detection — round amounts, late-night tx,
 *         rapid in-and-out (fan-out).
 *  - Each detected issue creates an `AMLAlert` in-process AND persists
 *    it to the `AMLAlert` Prisma table via `amlPipeline.persistAlert()`
 *    (canonical stack). The DB write is fire-and-forget — a DB failure
 *    does NOT fail the in-memory alert.
 *  - `scoreEntity(entityId)` returns an aggregate 0–100 risk score
 *    derived from open alerts (consumed by `risk-scoring.ts`).
 *  - `getAlerts(filter?)` / `getAlert(id)` / `updateAlertStatus(id, status)`
 *    drive analyst workflows and case-management integration. These
 *    operate on the IN-MEMORY alert cache; the canonical
 *    `amlPipeline.listAlerts()` reads from the DB.
 *
 * This service is rule-based. A production deployment would also pipe
 * transactions to a behavioural ML model (Chainalysis KYT, TRM Labs,
 * Elliptic) — the `AMLAlert` shape is unchanged so downstream case
 * management & SAR filing work for both rule-based and ML-derived
 * alerts.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { velocityService } from './velocity';
import {
  HIGH_RISK_CORRIDORS,
  REPORTING_THRESHOLD_USD,
  SEVERITY_WEIGHT,
  type AMLAlert,
  type AMLAlertSeverity,
  type AMLAlertStatus,
  type AMLAlertType,
  type ComplianceTx,
  type EntityType,
} from './types';
import { amlPipeline } from '@/trust/aml-pipeline';

/** Structuring detection parameters. */
const STRUCTURING_THRESHOLD_PCT = 0.85; // tx ≥ 85% of reporting threshold
const STRUCTURING_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const STRUCTURING_MIN_TX_COUNT = 3;

/** Unusual-pattern parameters. */
const ROUND_AMOUNT_DIVISOR = 1000;
const LATE_NIGHT_START_HOUR = 23;
const LATE_NIGHT_END_HOUR = 5;
const FAN_OUT_MIN_COUNTERPARTIES = 5;
const FAN_OUT_WINDOW_MS = 60 * 60 * 1000;

/** Filter for `getAlerts`. */
export interface AMLAlertFilter {
  entityId?: string;
  alertType?: AMLAlertType;
  severity?: AMLAlertSeverity;
  status?: AMLAlertStatus;
}

/** Result of `monitorTransaction`. */
export interface MonitorResult {
  txId: string;
  alerts: AMLAlert[];
  /** Highest severity across all alerts raised (or null). */
  highestSeverity: AMLAlertSeverity | null;
}

/** Per-entity recent-transaction memory (for structuring / fan-out). */
interface TxMemory {
  txId: string;
  entityId: string;
  amount: number;
  ts: number;
  counterpartyId?: string;
  senderCountry?: string;
  receiverCountry?: string;
}

export class AMLService {
  private alerts = new Map<string, AMLAlert>();
  private txMemory: TxMemory[] = [];

  // ------------------------------------------------------- monitorTransaction
  monitorTransaction(tx: ComplianceTx, entityType: EntityType = 'individual'): MonitorResult {
    const alerts: AMLAlert[] = [];

    // Record tx for velocity + structuring/fan-out analysis.
    this.txMemory.push({
      txId: tx.id,
      entityId: tx.entityId,
      amount: tx.amount,
      ts: tx.ts,
      counterpartyId: tx.counterpartyId,
      senderCountry: tx.senderCountry,
      receiverCountry: tx.receiverCountry,
    });
    velocityService.recordTransaction(tx.entityId, tx.amount);

    const structuring = this.detectStructuring(tx);
    if (structuring) alerts.push(structuring);

    const velocity = this.detectVelocity(tx, entityType);
    alerts.push(...velocity);

    const corridor = this.detectHighRiskCorridor(tx);
    if (corridor) alerts.push(corridor);

    const patterns = this.detectUnusualPatterns(tx);
    alerts.push(...patterns);

    for (const a of alerts) {
      this.alerts.set(a.id, a);
      eventEngine.emit('compliance.aml_alert', {
        alertId: a.id,
        entityId: a.entityId,
        alertType: a.alertType,
        severity: a.severity,
        score: a.score,
        details: a.details,
        txIds: a.txIds,
      });
      // P3-4 / H-8: delegate persistence to the canonical Prisma-backed stack.
      // Fire-and-forget — a DB failure must NOT fail the in-memory alert.
      amlPipeline
        .persistAlert(this.toCanonicalRecord(a, entityType))
        .catch((err: unknown) => {
          console.error('[aml-wrapper] canonical persistAlert failed:', err);
        });
    }

    const highestSeverity = alerts.reduce<AMLAlertSeverity | null>((acc, a) => {
      if (!acc) return a.severity;
      return SEVERITY_WEIGHT[a.severity] > SEVERITY_WEIGHT[acc] ? a.severity : acc;
    }, null);

    return { txId: tx.id, alerts, highestSeverity };
  }

  // ------------------------------------------------------- getAlerts
  getAlerts(filter?: AMLAlertFilter): AMLAlert[] {
    const all = [...this.alerts.values()];
    return all.filter((a) => {
      if (filter?.entityId && a.entityId !== filter.entityId) return false;
      if (filter?.alertType && a.alertType !== filter.alertType) return false;
      if (filter?.severity && a.severity !== filter.severity) return false;
      if (filter?.status && a.status !== filter.status) return false;
      return true;
    });
  }

  // ------------------------------------------------------- getAlert
  getAlert(id: string): AMLAlert | undefined {
    return this.alerts.get(id);
  }

  // ------------------------------------------------------- updateAlertStatus
  updateAlertStatus(id: string, status: AMLAlertStatus, assignedTo?: string): AMLAlert {
    const alert = this.alerts.get(id);
    if (!alert) {
      throw new Error(`AML alert ${id} not found`);
    }
    alert.status = status;
    alert.updatedAt = nowTs();
    if (assignedTo) alert.assignedTo = assignedTo;
    // P3-4 / H-8: delegate status update to the canonical stack (DB write).
    amlPipeline
      .updateStatus(id, status)
      .catch((err: unknown) => {
        console.error('[aml-wrapper] canonical updateStatus failed:', err);
      });
    return alert;
  }

  // ------------------------------------------------------- scoreEntity
  /**
   * Aggregate 0–100 AML risk score for an entity from its open alerts.
   * Capped at 100. Closed/SAR-filed alerts are excluded.
   */
  scoreEntity(entityId: string): number {
    const open = this.getAlerts({ entityId }).filter(
      (a) => a.status === 'open' || a.status === 'investigating' || a.status === 'escalated',
    );
    if (open.length === 0) return 0;
    const sum = open.reduce((s, a) => s + SEVERITY_WEIGHT[a.severity], 0);
    return Math.min(100, sum);
  }

  // ------------------------------------------------------- detection: structuring
  private detectStructuring(tx: ComplianceTx): AMLAlert | null {
    if (tx.amount >= REPORTING_THRESHOLD_USD) return null;
    if (tx.amount < REPORTING_THRESHOLD_USD * STRUCTURING_THRESHOLD_PCT) return null;

    const cutoff = tx.ts - STRUCTURING_LOOKBACK_MS;
    const nearThreshold = this.txMemory.filter(
      (m) =>
        m.entityId === tx.entityId &&
        m.ts >= cutoff &&
        m.ts <= tx.ts &&
        m.amount >= REPORTING_THRESHOLD_USD * STRUCTURING_THRESHOLD_PCT &&
        m.amount < REPORTING_THRESHOLD_USD,
    );
    if (nearThreshold.length < STRUCTURING_MIN_TX_COUNT) return null;

    const total = nearThreshold.reduce((s, m) => s + m.amount, 0);
    return this.makeAlert(
      tx.entityId,
      'individual',
      'structuring',
      'high',
      70,
      `${nearThreshold.length} transactions within 85% of $${REPORTING_THRESHOLD_USD} threshold in 24h (total $${total.toFixed(2)}). Possible structuring to evade reporting.`,
      nearThreshold.map((m) => m.txId),
    );
  }

  // ------------------------------------------------------- detection: velocity
  private detectVelocity(tx: ComplianceTx, entityType: EntityType): AMLAlert[] {
    const breaches = velocityService.checkThresholds(tx.entityId);
    return breaches.map((b) => {
      const t = velocityService.resolveThresholds(tx.entityId, entityType).find((x) => x.window === b.window);
      const severity: AMLAlertSeverity =
        b.txVolume >= (t?.maxTxVolume ?? Infinity) * 2 ? 'critical' : 'high';
      const score = severity === 'critical' ? 90 : 60;
      return this.makeAlert(
        tx.entityId,
        entityType,
        'velocity',
        severity,
        score,
        `Velocity threshold breached for window ${b.window}: ${b.txCount} txs ($${b.txVolume.toFixed(2)}) vs limit ${t?.maxTxCount} txs ($${t?.maxTxVolume}).`,
        [tx.id],
      );
    });
  }

  // ------------------------------------------------------- detection: corridor
  private detectHighRiskCorridor(tx: ComplianceTx): AMLAlert | null {
    const from = tx.senderCountry;
    const to = tx.receiverCountry;
    if (!from || !to) return null;
    const hit = HIGH_RISK_CORRIDORS.find(
      (c) =>
        (c.from === from && c.to === to) ||
        (c.from === to && c.to === from),
    );
    if (!hit) return null;
    return this.makeAlert(
      tx.entityId,
      'individual',
      'high_risk_corridor',
      'critical',
      85,
      `Transaction on high-risk corridor ${from} ↔ ${to}: ${hit.reason}.`,
      [tx.id],
    );
  }

  // ------------------------------------------------------- detection: unusual patterns
  private detectUnusualPatterns(tx: ComplianceTx): AMLAlert[] {
    const out: AMLAlert[] = [];

    // Round-amount heuristic (>$10k rounded to nearest $1,000).
    if (tx.amount >= REPORTING_THRESHOLD_USD && tx.amount % ROUND_AMOUNT_DIVISOR === 0) {
      out.push(
        this.makeAlert(
          tx.entityId,
          'individual',
          'unusual_pattern',
          'low',
          25,
          `Round-amount transaction $${tx.amount.toFixed(2)} (divisible by $${ROUND_AMOUNT_DIVISOR}).`,
          [tx.id],
        ),
      );
    }

    // Late-night transaction heuristic.
    const hour = new Date(tx.ts).getHours();
    const isLateNight =
      hour >= LATE_NIGHT_START_HOUR || hour < LATE_NIGHT_END_HOUR;
    if (isLateNight && tx.amount >= REPORTING_THRESHOLD_USD / 2) {
      out.push(
        this.makeAlert(
          tx.entityId,
          'individual',
          'unusual_pattern',
          'low',
          20,
          `Late-night transaction at hour ${hour}:00 ($${tx.amount.toFixed(2)}).`,
          [tx.id],
        ),
      );
    }

    // Fan-out: ≥5 distinct counterparties within 1h.
    const cutoff = tx.ts - FAN_OUT_WINDOW_MS;
    const recent = this.txMemory.filter(
      (m) => m.entityId === tx.entityId && m.ts >= cutoff && m.ts <= tx.ts,
    );
    const counterparties = new Set(recent.map((m) => m.counterpartyId).filter(Boolean));
    if (counterparties.size >= FAN_OUT_MIN_COUNTERPARTIES) {
      out.push(
        this.makeAlert(
          tx.entityId,
          'individual',
          'unusual_pattern',
          'medium',
          40,
          `Fan-out pattern: ${counterparties.size} distinct counterparties within 1h window.`,
          recent.map((m) => m.txId),
        ),
      );
    }

    return out;
  }

  // ------------------------------------------------------- helper
  private makeAlert(
    entityId: string,
    entityType: EntityType,
    alertType: AMLAlertType,
    severity: AMLAlertSeverity,
    score: number,
    details: string,
    txIds: string[],
  ): AMLAlert {
    const ts = nowTs();
    return {
      id: uid('aml'),
      entityId,
      entityType,
      alertType,
      severity,
      score,
      details,
      txIds,
      createdAt: ts,
      status: 'open',
      updatedAt: ts,
    };
  }

  /**
   * Convert a legacy `AMLAlert` (protocol/compliance shape) to a canonical
   * `AMLAlertRecord` (src/trust shape) for Prisma persistence. The two
   * types disagree on `entityType` enum values + a few field names — this
   * helper bridges.
   */
  private toCanonicalRecord(
    alert: AMLAlert,
    entityType: EntityType,
  ): import('@/trust/types').AMLAlertRecord {
    // Map protocol EntityType → trust EntityType (different unions).
    const trustEntityType = mapEntityTypeToTrust(entityType);
    return {
      id: alert.id,
      ruleId: alert.alertType,
      ruleName: alert.alertType,
      entityId: alert.entityId,
      entityType: trustEntityType,
      severity: alert.severity,
      action: 'review' as const,
      status: alert.status,
      description: alert.details,
      evidence: [
        {
          alertType: alert.alertType,
          score: alert.score,
          txIds: alert.txIds,
          createdAt: alert.createdAt,
        },
      ],
      transactionId: alert.txIds[0],
      riskScore: alert.score,
      assignedTo: alert.assignedTo,
      createdAt: alert.createdAt,
    };
  }
}

/**
 * Map a protocol/compliance `EntityType` to the trust `EntityType`.
 * The two unions are different (protocol has `individual`+`business`,
 * trust has `user`+`merchant`). Used by `AMLService.toCanonicalRecord()`.
 */
function mapEntityTypeToTrust(et: EntityType): import('@/trust/types').EntityType {
  switch (et) {
    case 'individual':
      return 'user';
    case 'business':
      return 'merchant';
    case 'merchant':
      return 'merchant';
    case 'lp':
      return 'lp';
    case 'treasury':
      return 'merchant'; // closest match — treasury is a system actor
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForAML = globalThis as unknown as { __PAYSWAP_AML_SERVICE?: AMLService };
export const amlService = _globalForAML.__PAYSWAP_AML_SERVICE ?? new AMLService();
if (!_globalForAML.__PAYSWAP_AML_SERVICE) _globalForAML.__PAYSWAP_AML_SERVICE = amlService;
