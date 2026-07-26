/**
 * PaySwap Protocol — Compliance Framework.
 *
 * Drop-in regulatory compliance module for a regulated financial
 * institution: KYC, KYB, AML monitoring, sanctions screening, PEP
 * screening, FATF Travel Rule, risk scoring, velocity monitoring, case
 * management, SAR filing, and regulatory audit exports.
 *
 * DESIGN PRINCIPLE — every compliance check is a *gate*:
 *
 *   kycService.requireLevel(entityId, 2)
 *   sanctionsService.requireClear(entityId)
 *   kybService.requireVerified(companyId)
 *   riskScoringService.requireBelow(entityId, 50, { country })
 *
 * Each `require*` method returns void on success and throws a
 * `ComplianceError` on failure. The payment flow calls these gates
 * before reaching the settlement layer — failed gates block settlement
 * with a structured error the user-facing API can render.
 *
 * PROVIDER-READINESS:
 *  - Sanctions: in-memory sample list (OFAC/EU/UN/UK HMT) + Levenshtein
 *    matcher. Swap `SanctionsService.loadList()` + the inner of
 *    `matchName()` for Chainalysis KYT / TRM Labs / Refinitiv.
 *  - PEP: in-memory sample database. Swap `PEPService.loadList()` +
 *    matcher for Refinitiv World-Check / Dow Jones R&C.
 *  - KYC: `KYCService.verifyDocument()` inner check is the provider
 *    seam (Onfido, Jumio, Persona, Smile Identity).
 *  - Travel Rule: `TravelRuleService.transmit()` is the provider seam
 *    (NOTABENE, Sygna Bridge, Sumsub, TRP).
 *  - SAR: `SARService.fileSAR()` is the FIU submission seam (FinCEN
 *    BSA E-Filing, NCA SAR Online, NFIU, FRC, FIC).
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs`, and
 * `eventEngine` from `@/kernel/*`. No kernel files are modified.
 */
import { kycService } from './kyc';
import { sanctionsService } from './sanctions';
import { riskScoringService } from './risk-scoring';
import type { EntityType, KYCLevel } from './types';

export * from './types';

export {
  KYCService,
  kycService,
  type SubmitDocumentInput,
  type VerifyDocumentResult,
} from './kyc';

export {
  KYBService,
  kybService,
  type SubmitKYBInput,
  type VerifyKYBResult,
} from './kyb';

export {
  AMLService,
  amlService,
  type AMLAlertFilter,
  type MonitorResult,
} from './aml';

export {
  SanctionsService,
  sanctionsService,
  levenshtein,
  tokenJaccard,
  type ScreenInput,
  type ScreenResult,
} from './sanctions';

export {
  PEPService,
  pepService,
  type ScreenPEPResult,
} from './pep';

export {
  TravelRuleService,
  travelRuleService,
  type TravelRuleParty,
  type CreateTravelRuleInput,
  type CreateTravelRuleResult,
} from './travel-rule';

export {
  RiskScoringService,
  riskScoringService,
  DEFAULT_FACTOR_WEIGHTS,
  RISK_LEVEL_THRESHOLDS,
  levelForScore,
  type AssessRiskInput,
  type AssessRiskResult,
} from './risk-scoring';

export {
  VelocityService,
  velocityService,
} from './velocity';

export {
  CaseService,
  caseService,
  type CreateCaseInput,
  type CaseFilter,
} from './case-management';

export {
  SARService,
  sarService,
  type SARFilter,
  type FileSARResult,
} from './sar';

export {
  AuditExportService,
  auditExportService,
  type TransactionReportFilter,
  type TimeRange,
  type ComplianceReport,
  type TransactionReport,
  type SARReport,
  type KYCReport,
} from './audit-export';

/**
 * Convenience: run every gate a regulated payment must clear before
 * settlement. Throws the first `ComplianceError` encountered.
 *
 *   entityId         — payer entity id
 *   requiredKycLevel — minimum KYC tier (1=basic, 2=full, 3=EDD)
 *   riskContext      — country + entity type for risk scoring
 *   maxRiskScore     — caller's risk tolerance (0–100)
 */
export function enforcePaymentGates(
  entityId: string,
  requiredKycLevel: KYCLevel,
  riskContext: { country: string; entityType?: EntityType; industry?: string },
  maxRiskScore: number,
): void {
  // 1. KYC gate
  kycService.requireLevel(entityId, requiredKycLevel);
  // 2. Sanctions gate
  sanctionsService.requireClear(entityId);
  // 3. Risk-scoring gate
  riskScoringService.requireBelow(entityId, maxRiskScore, riskContext);
}
