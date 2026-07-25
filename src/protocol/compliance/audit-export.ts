/**
 * PaySwap Protocol — Regulatory Audit Export Service.
 *
 * Generates JSON reports suitable for regulatory submission / internal
 * audit. Each export is a self-contained, timestamped JSON document
 * with a stable schema so external auditors (and regulatory examiners)
 * can be handed a single file per entity or period.
 *
 * Exports:
 *  - `exportComplianceReport(entityId, fromTs, toTs)` — everything we
 *    know about an entity: KYC dossier, KYB record (if business),
 *    PEP status, sanctions hits, AML alerts, risk score, velocity,
 *    travel-rule records, linked cases, and any filed SARs.
 *  - `exportTransactionReport(filter)` — all compliance events for a
 *    transaction (alerts raised, travel-rule record, sanctions screening
 *    of originator + beneficiary).
 *  - `exportSARReport(range)` — all SARs filed within the time range.
 *  - `exportKYCReport(entityId)` — KYC dossier detail.
 *
 * Reports include a `generatedAt` timestamp, a `reportId` for chain-of-
 * custody, and a `schemaVersion` so downstream consumers can migrate
 * cleanly.
 */
import { uid, nowTs } from '@/kernel/support';
import { kycService } from './kyc';
import { kybService } from './kyb';
import { amlService } from './aml';
import { sanctionsService } from './sanctions';
import { pepService } from './pep';
import { travelRuleService } from './travel-rule';
import { velocityService } from './velocity';
import { riskScoringService } from './risk-scoring';
import { caseService } from './case-management';
import { sarService } from './sar';
import type {
  AMLAlert,
  KYCDossier,
  KYBRecord,
  PEPStatus,
  RiskScore,
  SAR,
  SanctionsHit,
  TravelRuleRecord,
  VelocityRecord,
  Case,
} from './types';

const SCHEMA_VERSION = '1.0.0';

/** Filter for `exportTransactionReport`. */
export interface TransactionReportFilter {
  txId?: string;
  entityId?: string;
  fromTs?: number;
  toTs?: number;
}

/** Time-range filter for `exportSARReport`. */
export interface TimeRange {
  fromTs: number;
  toTs: number;
}

/** Base shape every report embeds. */
interface ReportBase {
  reportId: string;
  schemaVersion: string;
  generatedAt: number;
}

export interface ComplianceReport extends ReportBase {
  type: 'entity_compliance';
  entityId: string;
  fromTs: number;
  toTs: number;
  kyc?: KYCDossier;
  kyb?: KYBRecord;
  pep?: PEPStatus;
  sanctionsHits: SanctionsHit[];
  amlAlerts: AMLAlert[];
  velocity: VelocityRecord[];
  riskScore?: RiskScore;
  cases: Case[];
  sars: SAR[];
}

export interface TransactionReport extends ReportBase {
  type: 'transaction_compliance';
  filter: TransactionReportFilter;
  travelRuleRecords: TravelRuleRecord[];
  amlAlerts: AMLAlert[];
  sanctionsHits: SanctionsHit[];
}

export interface SARReport extends ReportBase {
  type: 'sar_period';
  range: TimeRange;
  sars: SAR[];
}

export interface KYCReport extends ReportBase {
  type: 'kyc_dossier';
  entityId: string;
  dossier?: KYCDossier;
}

export class AuditExportService {
  // ------------------------------------------------------- exportComplianceReport
  exportComplianceReport(entityId: string, fromTs: number, toTs: number): ComplianceReport {
    return {
      reportId: uid('rpt'),
      schemaVersion: SCHEMA_VERSION,
      generatedAt: nowTs(),
      type: 'entity_compliance',
      entityId,
      fromTs,
      toTs,
      kyc: kycService.getDossier(entityId),
      kyb: kybService.getKYB(entityId),
      pep: pepService.getPEPStatus(entityId),
      sanctionsHits: sanctionsService.getHits(entityId),
      amlAlerts: amlService.getAlerts({ entityId }).filter(
        (a) => a.createdAt >= fromTs && a.createdAt <= toTs,
      ),
      velocity: velocityService.getVelocity(entityId),
      riskScore: riskScoringService.getScore(entityId),
      cases: caseService.listCases({ entityId }),
      sars: sarService.listSARs().filter(
        (s) => (s.filedAt ?? s.createdAt) >= fromTs && (s.filedAt ?? s.createdAt) <= toTs,
      ),
    };
  }

  // ------------------------------------------------------- exportTransactionReport
  exportTransactionReport(filter: TransactionReportFilter): TransactionReport {
    const alerts = amlService.getAlerts().filter((a) => {
      if (filter.entityId && a.entityId !== filter.entityId) return false;
      if (filter.fromTs && a.createdAt < filter.fromTs) return false;
      if (filter.toTs && a.createdAt > filter.toTs) return false;
      if (filter.txId && !a.txIds.includes(filter.txId)) return false;
      return true;
    });

    const sanctionsHits = sanctionsService.getHits().filter((h) => {
      if (filter.entityId && h.entityId !== filter.entityId) return false;
      if (filter.fromTs && h.createdAt < filter.fromTs) return false;
      if (filter.toTs && h.createdAt > filter.toTs) return false;
      return true;
    });

    const travelRuleRecords: TravelRuleRecord[] = [];
    if (filter.txId) {
      const rec = travelRuleService.getRecord(filter.txId);
      if (rec) travelRuleRecords.push(rec);
    }

    return {
      reportId: uid('rpt'),
      schemaVersion: SCHEMA_VERSION,
      generatedAt: nowTs(),
      type: 'transaction_compliance',
      filter,
      travelRuleRecords,
      amlAlerts: alerts,
      sanctionsHits,
    };
  }

  // ------------------------------------------------------- exportSARReport
  exportSARReport(range: TimeRange): SARReport {
    const sars = sarService.listSARs().filter((s) => {
      const ts = s.filedAt ?? s.createdAt;
      return ts >= range.fromTs && ts <= range.toTs;
    });
    return {
      reportId: uid('rpt'),
      schemaVersion: SCHEMA_VERSION,
      generatedAt: nowTs(),
      type: 'sar_period',
      range,
      sars,
    };
  }

  // ------------------------------------------------------- exportKYCReport
  exportKYCReport(entityId: string): KYCReport {
    return {
      reportId: uid('rpt'),
      schemaVersion: SCHEMA_VERSION,
      generatedAt: nowTs(),
      type: 'kyc_dossier',
      entityId,
      dossier: kycService.getDossier(entityId),
    };
  }

  /** Convenience: produce a pretty-printed JSON string of any report. */
  toJSON(report: ComplianceReport | TransactionReport | SARReport | KYCReport): string {
    return JSON.stringify(report, null, 2);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForAuditExport = globalThis as unknown as { __PAYSWAP_AUDIT_EXPORT_SERVICE?: AuditExportService };
export const auditExportService =
  _globalForAuditExport.__PAYSWAP_AUDIT_EXPORT_SERVICE ?? new AuditExportService();
if (!_globalForAuditExport.__PAYSWAP_AUDIT_EXPORT_SERVICE) {
  _globalForAuditExport.__PAYSWAP_AUDIT_EXPORT_SERVICE = auditExportService;
}
