/**
 * Trust & Compliance OS — Core Types. (M-TRUST-40.)
 *
 * The Trust Engine is the compliance substrate. It provides:
 *   - Risk scoring (per entity, based on multiple factors)
 *   - AML pipeline (rule-based transaction monitoring)
 *   - Sanctions screening (fuzzy name matching against watchlists)
 *   - KYC / KYB workflow (identity verification)
 *   - SAR management (Suspicious Activity Reports)
 *   - Travel rule compliance (FATF Recommendation 16)
 *   - Audit trail (immutable compliance log)
 *
 * The Trust Engine sits ABOVE the runtime kernel — it reads transactions
 * from the event store and writes compliance decisions back to the DB.
 * It does NOT modify the frozen kernel.
 */

// ─── Risk Scoring ──────────────────────────────────────────────────────────

export type EntityType = 'user' | 'merchant' | 'lp' | 'transaction' | 'wallet';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskFactor {
  name: string;            // e.g., "high_velocity", "structuring_pattern"
  weight: number;          // contribution to score (0-100)
  detail: string;
}

export interface RiskScore {
  entityId: string;
  entityType: EntityType;
  score: number;           // 0-100, higher = riskier
  level: RiskLevel;
  factors: RiskFactor[];
  computedAt: number;
  expiresAt: number;       // scores expire after 24h
}

// ─── AML ────────────────────────────────────────────────────────────────────

export type AMLAction = 'flag' | 'block' | 'review' | 'report';

export interface AMLRule {
  id: string;
  name: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: AMLAction;
  // Rule predicate — returns true if the transaction matches
  evaluate(tx: TransactionContext): boolean;
  // Human-readable reason for the match
  explain(tx: TransactionContext): string;
}

export interface TransactionContext {
  transactionId: string;
  entityId: string;
  entityType: EntityType;
  amount: number;
  currency: string;
  sourceCountry: string;
  destCountry: string;
  timestamp: number;
  // History context (precomputed by the monitor)
  recentTransactions: TransactionSummary[];
  entityAgeDays: number;
  kycStatus: 'verified' | 'pending' | 'rejected' | 'none';
  isPEP: boolean;          // Politically Exposed Person
}

export interface TransactionSummary {
  amount: number;
  currency: string;
  timestamp: number;
  sourceCountry: string;
  destCountry: string;
}

export interface AMLAlertRecord {
  id: string;
  ruleId: string;
  ruleName: string;
  entityId: string;
  entityType: EntityType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: AMLAction;
  status: 'open' | 'investigating' | 'escalated' | 'closed' | 'sar_filed';
  description: string;
  evidence: Record<string, unknown>[];
  transactionId?: string;
  riskScore?: number;
  assignedTo?: string;
  createdAt: number;
  resolvedAt?: number;
  resolution?: string;
}

// ─── Sanctions ──────────────────────────────────────────────────────────────

export type SanctionsList = 'OFAC' | 'UN' | 'EU' | 'HMT' | 'internal_watchlist';

export interface SanctionsScreening {
  id: string;
  entityId: string;
  entityName: string;
  matchedName: string;
  matchedList: SanctionsList;
  matchScore: number;      // 0-100, fuzzy match confidence
  status: 'pending' | 'true_positive' | 'false_positive' | 'review';
  screenedAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  notes?: string;
}

// ─── KYC / KYB ──────────────────────────────────────────────────────────────

export type KYCType = 'kyc' | 'kyb';
export type KYCStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'expired';

export interface KYCDocument {
  type: 'passport' | 'id_card' | 'drivers_license' | 'utility_bill' | 'bank_statement' | 'business_registration' | 'articles_of_incorporation';
  filename: string;
  uploadedAt: number;
  verified: boolean;
}

export interface VerificationResult {
  type: 'identity' | 'address' | 'liveness' | 'sanctions' | 'pep' | 'adverse_media' | 'business_registry';
  status: 'pass' | 'fail' | 'pending';
  detail: string;
  checkedAt: number;
}

export interface KYCVerification {
  id: string;
  entityId: string;
  entityName: string;
  type: KYCType;
  status: KYCStatus;
  documents: KYCDocument[];
  verifications: VerificationResult[];
  submittedAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
  expiresAt?: number;
  notes?: string;
}

// ─── SAR ─────────────────────────────────────────────────────────────────────

export type SARStatus = 'draft' | 'filed' | 'acknowledged' | 'closed';

export interface SARRecord {
  id: string;
  alertIds: string[];
  subject: string;
  narrative: string;
  amount: number;
  currency: string;
  status: SARStatus;
  filedAt?: number;
  filedBy?: string;
  regulatorReference?: string;
  createdAt: number;
}

// ─── Travel Rule (FATF Recommendation 16) ──────────────────────────────────

export interface TravelRuleRecord {
  id: string;
  transactionId: string;
  originator: {
    name: string;
    account: string;
    address?: string;
    country?: string;
  };
  beneficiary: {
    name: string;
    account: string;
    address?: string;
    country?: string;
  };
  amount: number;
  currency: string;
  threshold: number;       // travel rule applies above this
  transmittedAt?: number;
  status: 'pending' | 'transmitted' | 'failed';
  createdAt: number;
}

// ─── Audit Trail ─────────────────────────────────────────────────────────────

export interface ComplianceAuditEntry {
  id: string;
  action: string;          // e.g., "alert.escalated", "kyc.approved", "sar.filed"
  actorId: string;
  entityType: EntityType | 'alert' | 'kyc' | 'sar' | 'sanctions' | 'travel_rule';
  entityId: string;
  details: Record<string, unknown>;
  result?: string;         // SUCCESS, DENIED, ERROR
  timestamp: number;
  createdAt?: number;      // alias for timestamp
}

export interface AuditFilter {
  action?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  result?: string;
  from?: number;
  to?: number;
  limit?: number;
}

// ─── Trust Engine Overview ──────────────────────────────────────────────────

export interface TrustOverview {
  alerts: {
    total: number;
    open: number;
    investigating: number;
    escalated: number;
    closed: number;
    sarFiled: number;
    bySeverity: Record<string, number>;
  };
  kyc: {
    total: number;
    pending: number;
    inReview: number;
    approved: number;
    rejected: number;
    expired: number;
  };
  sanctions: {
    total: number;
    pending: number;
    truePositives: number;
    falsePositives: number;
  };
  sars: {
    total: number;
    draft: number;
    filed: number;
    acknowledged: number;
    closed: number;
  };
  risk: {
    totalScored: number;
    byLevel: Record<RiskLevel, number>;
    averageScore: number;
  };
  travelRule: {
    total: number;
    pending: number;
    transmitted: number;
    failed: number;
  };
  auditEvents: number;
}
