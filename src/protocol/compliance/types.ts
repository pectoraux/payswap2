/**
 * PaySwap Protocol — Compliance Framework Types.
 *
 * Central type registry for the protocol-layer compliance module
 * (`src/protocol/compliance/`). Every compliance service (KYC, KYB, AML,
 * sanctions, PEP, travel rule, risk scoring, velocity, case management,
 * SAR, audit export) imports its public types from here — this keeps the
 * dependency graph flat (no service imports another service's types) and
 * makes the surface trivially auditable by a compliance officer.
 *
 * Design notes:
 *  - All identifiers are opaque strings (`entityId`, `companyId`, `txId`).
 *    They are minted by upstream services (wallet, ledger, treasury) and
 *    passed in. The compliance layer never assumes their format.
 *  - Every gate-style method (`requireLevel`, `requireBelow`, `isClear`,
 *    `requireVerified`) returns void on success and throws a
 *    `ComplianceError` on failure — the payment flow calls these gates
 *    before reaching the settlement layer.
 *  - Timestamps are epoch milliseconds (`Date.now()`).
 *  - All "list" / "level" / "status" unions are string-literal types so
 *    the JSON exports produced by `audit-export.ts` are self-describing.
 */

// ---------------------------------------------------------------------------
// Core enums / unions
// ---------------------------------------------------------------------------

/** KYC verification tier (0 = unverified → 3 = enhanced due diligence). */
export type KYCLevel = 0 | 1 | 2 | 3;

/** Lifecycle status of an entity's KYC dossier. */
export type KYCStatus = 'pending' | 'verified' | 'rejected' | 'expired' | 'review';

/** Document categories accepted for KYC evidence. */
export type KYCDocumentType =
  | 'passport'
  | 'national_id'
  | 'drivers_license'
  | 'utility_bill'
  | 'bank_statement';

/** Entity classification used throughout the compliance module. */
export type EntityType = 'individual' | 'business' | 'merchant' | 'lp' | 'treasury';

// ---------------------------------------------------------------------------
// KYC
// ---------------------------------------------------------------------------

/** A single KYC document uploaded by an entity. */
export interface KYCDocument {
  id: string;
  type: KYCDocumentType;
  holder: string;
  country: string;
  uploadedAt: number;
  verifiedAt?: number;
  /** Evidence id from the kernel evidence engine, if attested. */
  evidenceId?: string;
  /** Rejection reason, populated when verified=false. */
  rejectionReason?: string;
}

/** Aggregated KYC dossier for an entity. */
export interface KYCDossier {
  entityId: string;
  level: KYCLevel;
  status: KYCStatus;
  documents: KYCDocument[];
  /** Country of residence declared by the entity (drives high-risk escalation). */
  country: string;
  /** When the dossier was last verified. */
  verifiedAt?: number;
  /** Hard expiry — dossiers past this ts are auto-expired by `expireIfStale`. */
  expiresAt?: number;
  /** Free-text review notes from a compliance analyst. */
  reviewNotes?: string;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// KYB
// ---------------------------------------------------------------------------

/** Know-Your-Business verification record. */
export interface KYBRecord {
  companyId: string;
  legalName: string;
  registrationNumber: string;
  jurisdiction: string;
  directors: string[];
  /** Ultimate Beneficial Owners with >25% ownership must be KYC'd individually. */
  beneficialOwners: { name: string; ownershipPct: number }[];
  registeredAddress: string;
  status: KYCStatus;
  /** Verified-at ts (set when `verifyKYB` succeeds). */
  verifiedAt?: number;
  /** Cross-reference of KYC dossier ids for each UBO. */
  uboKycRefs?: { name: string; kycEntityId: string }[];
  /** Review notes from a compliance analyst. */
  reviewNotes?: string;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// AML
// ---------------------------------------------------------------------------

export type AMLAlertType =
  | 'structuring'
  | 'velocity'
  | 'high_risk_corridor'
  | 'pep'
  | 'sanctions_hit'
  | 'unusual_pattern';

export type AMLAlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export type AMLAlertStatus = 'open' | 'investigating' | 'escalated' | 'closed' | 'sar_filed';

/** A single AML alert raised by monitoring or screening. */
export interface AMLAlert {
  id: string;
  entityId: string;
  entityType: EntityType;
  alertType: AMLAlertType;
  severity: AMLAlertSeverity;
  /** 0–100 risk score for this specific alert. */
  score: number;
  details: string;
  /** Linked transaction ids (if any). */
  txIds: string[];
  createdAt: number;
  status: AMLAlertStatus;
  /** Analyst assigned to investigate. */
  assignedTo?: string;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Sanctions
// ---------------------------------------------------------------------------

export type SanctionsList = 'ofac' | 'eu' | 'un' | 'uk_hmt' | 'custom';

/** A positive match against a sanctions list. */
export interface SanctionsHit {
  id: string;
  entityId: string;
  list: SanctionsList;
  matchedName: string;
  matchedEntry: string;
  /** 0–1 similarity score from the fuzzy matcher. */
  score: number;
  reviewedAt?: number;
  isFalsePositive?: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// PEP
// ---------------------------------------------------------------------------

export type PEPType =
  | 'head_of_state'
  | 'senior_official'
  | 'judicial'
  | 'military'
  | 'state_owned_enterprise'
  | 'none';

/** PEP (Politically Exposed Person) screening result. */
export interface PEPStatus {
  entityId: string;
  isPEP: boolean;
  pepType: PEPType;
  /** Source of the PEP designation (e.g. "internal_database", "refinitiv"). */
  source: string;
  reviewedAt: number;
  /** Matched name from the PEP database, if any. */
  matchedName?: string;
  /** Similarity score 0–1. */
  score?: number;
}

// ---------------------------------------------------------------------------
// Risk scoring
// ---------------------------------------------------------------------------

export type RiskLevel = 'low' | 'medium' | 'high' | 'prohibited';

/** Single factor contributing to the overall risk score. */
export interface RiskFactor {
  factor: string;
  /** 0–1 relative weight of this factor. */
  weight: number;
  /** Absolute contribution to the 0–100 score. */
  contribution: number;
  /** Optional human-readable rationale. */
  rationale?: string;
}

/** Composite risk score for an entity. */
export interface RiskScore {
  entityId: string;
  score: number; // 0–100
  level: RiskLevel;
  factors: RiskFactor[];
  assessedAt: number;
  /** Scores expire after 90 days — re-assessment required past this ts. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Travel Rule (FATF Recommendation 16)
// ---------------------------------------------------------------------------

export type TravelRuleStatus = 'pending' | 'transmitted' | 'failed' | 'not_required';

/** VASP-to-VASP travel-rule record for transactions ≥ $1000. */
export interface TravelRuleRecord {
  txId: string;
  originator: { name: string; account: string; address: string };
  beneficiary: { name: string; account: string; address: string };
  amount: number;
  currency: string;
  originatorVASP: string;
  beneficiaryVASP: string;
  transmittedAt?: number;
  status: TravelRuleStatus;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Case management
// ---------------------------------------------------------------------------

export type CaseType =
  | 'aml_alert'
  | 'sanctions_hit'
  | 'kyc_review'
  | 'kyb_review'
  | 'manual_review'
  | 'sar';

export type CaseStatus = 'open' | 'investigating' | 'escalated' | 'closed';

/** Investigation case grouping related alerts / hits / reviews. */
export interface Case {
  id: string;
  type: CaseType;
  entityId: string;
  alertIds: string[];
  status: CaseStatus;
  assignedTo?: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  resolution?: string;
  /** Immutable audit-trail of every action on this case. */
  auditTrail: CaseAuditEntry[];
}

export interface CaseAuditEntry {
  ts: number;
  action: string;
  actor?: string;
  details?: string;
}

// ---------------------------------------------------------------------------
// SAR
// ---------------------------------------------------------------------------

export type SARStatus = 'draft' | 'filed' | 'acknowledged';

/** Suspicious Activity Report. */
export interface SAR {
  id: string;
  caseId: string;
  filedAt?: number;
  filedBy?: string;
  narrative: string;
  amount: number;
  currency: string;
  entities: string[];
  regulatoryRef?: string;
  status: SARStatus;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Velocity monitoring
// ---------------------------------------------------------------------------

export type VelocityWindow = '1h' | '24h' | '7d' | '30d';

/** Aggregated velocity over a window for one entity. */
export interface VelocityRecord {
  entityId: string;
  window: VelocityWindow;
  txCount: number;
  txVolume: number;
  lastTxAt: number;
  thresholdHit?: boolean;
}

/** Per-window threshold configuration. */
export interface VelocityThreshold {
  window: VelocityWindow;
  maxTxCount: number;
  maxTxVolume: number;
}

/** Thresholds indexed by entity type. */
export type VelocityThresholdTable = Record<EntityType, VelocityThreshold[]>;

// ---------------------------------------------------------------------------
// Compliance transaction shape
// ---------------------------------------------------------------------------

/**
 * Minimal transaction shape consumed by the compliance module. Upstream
 * services (wallet, ledger, settlement) project their richer transaction
 * types into this shape before calling compliance gates.
 */
export interface ComplianceTx {
  id: string;
  entityId: string;
  counterpartyId?: string;
  amount: number;
  currency: string;
  direction: 'in' | 'out';
  ts: number;
  senderCountry?: string;
  receiverCountry?: string;
  channel?: string;
  /** Optional merchant/LP category code for industry risk. */
  industry?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Error thrown by any compliance gate when the check fails. */
export class ComplianceError extends Error {
  readonly code: string;
  readonly entityId?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    opts?: { entityId?: string; details?: Record<string, unknown> } & Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ComplianceError';
    this.code = code;
    this.entityId = opts?.entityId;
    this.details = opts as Record<string, unknown> | undefined;
  }
}

// ---------------------------------------------------------------------------
// Shared reference data (simulated)
// ---------------------------------------------------------------------------

/**
 * FATF grey/black list + high-risk jurisdictions for AML purposes.
 * In production this would be loaded from a managed feed (e.g. Refinitiv
 * World-Check, Dow Jones Risk & Compliance). The simulated list covers
 * the FATF high-risk jurisdictions under increased monitoring as of the
 * latest published list.
 */
export const HIGH_RISK_COUNTRIES: string[] = [
  'North Korea',
  'Iran',
  'Myanmar',
  'Syria',
  'Afghanistan',
  'Yemen',
  'Somalia',
  'South Sudan',
  'Libya',
  'Venezuela',
  'Pakistan',
  'Cayman Islands',
];

/**
 * Country pairs flagged as high-risk corridors for cross-border transfers.
 * Used by `aml.ts` to raise `high_risk_corridor` alerts.
 */
export const HIGH_RISK_CORRIDORS: { from: string; to: string; reason: string }[] = [
  { from: 'United States', to: 'North Korea', reason: 'OFAC embargo' },
  { from: 'United States', to: 'Iran', reason: 'OFAC embargo' },
  { from: 'United States', to: 'Syria', reason: 'OFAC embargo' },
  { from: 'United Kingdom', to: 'Iran', reason: 'UK HMT financial sanctions' },
  { from: 'European Union', to: 'Russia', reason: 'EU restrictive measures' },
  { from: 'Kenya', to: 'Somalia', reason: 'FATF increased monitoring' },
  { from: 'Ghana', to: 'Iran', reason: 'FATF black list' },
];

/** ISO country → ISO-2 code map for a small reference set. */
export const COUNTRY_CODE_MAP: Record<string, string> = {
  Kenya: 'KE',
  Ghana: 'GH',
  Nigeria: 'NG',
  'United States': 'US',
  'United Kingdom': 'GB',
  'South Africa': 'ZA',
  Uganda: 'UG',
  Tanzania: 'TZ',
  'European Union': 'EU',
  Russia: 'RU',
  Iran: 'IR',
  'North Korea': 'KP',
  Syria: 'SY',
  Somalia: 'SO',
  Venezuela: 'VE',
  Pakistan: 'PK',
  Afghanistan: 'AF',
  Yemen: 'YE',
  Myanmar: 'MM',
  Libya: 'LY',
  'South Sudan': 'SS',
  'Cayman Islands': 'KY',
};

/** Reporting threshold (USD-equivalent) for structuring detection. */
export const REPORTING_THRESHOLD_USD = 10_000;

/** Travel-rule threshold (USD-equivalent) per FATF Recommendation 16. */
export const TRAVEL_RULE_THRESHOLD_USD = 1_000;

/** Risk-score validity window (ms) — 90 days. */
export const RISK_SCORE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** KYC dossier staleness — auto-expire after 24 months without re-verification. */
export const KYC_STALE_MS = 24 * 30 * 24 * 60 * 60 * 1000;

/** Severity → numeric weight used by AML scoring. */
export const SEVERITY_WEIGHT: Record<AMLAlertSeverity, number> = {
  low: 15,
  medium: 35,
  high: 60,
  critical: 90,
};

/** Default velocity thresholds per entity type. */
export const DEFAULT_VELOCITY_THRESHOLDS: VelocityThresholdTable = {
  individual: [
    { window: '1h', maxTxCount: 10, maxTxVolume: 5_000 },
    { window: '24h', maxTxCount: 50, maxTxVolume: 10_000 },
    { window: '7d', maxTxCount: 200, maxTxVolume: 50_000 },
    { window: '30d', maxTxCount: 500, maxTxVolume: 200_000 },
  ],
  business: [
    { window: '1h', maxTxCount: 50, maxTxVolume: 50_000 },
    { window: '24h', maxTxCount: 200, maxTxVolume: 250_000 },
    { window: '7d', maxTxCount: 1_000, maxTxVolume: 1_000_000 },
    { window: '30d', maxTxCount: 5_000, maxTxVolume: 5_000_000 },
  ],
  merchant: [
    { window: '1h', maxTxCount: 200, maxTxVolume: 25_000 },
    { window: '24h', maxTxCount: 1_000, maxTxVolume: 100_000 },
    { window: '7d', maxTxCount: 5_000, maxTxVolume: 500_000 },
    { window: '30d', maxTxCount: 20_000, maxTxVolume: 2_000_000 },
  ],
  lp: [
    { window: '1h', maxTxCount: 100, maxTxVolume: 250_000 },
    { window: '24h', maxTxCount: 500, maxTxVolume: 1_000_000 },
    { window: '7d', maxTxCount: 2_000, maxTxVolume: 5_000_000 },
    { window: '30d', maxTxCount: 10_000, maxTxVolume: 25_000_000 },
  ],
  treasury: [
    { window: '1h', maxTxCount: 1_000, maxTxVolume: 10_000_000 },
    { window: '24h', maxTxCount: 10_000, maxTxVolume: 100_000_000 },
    { window: '7d', maxTxCount: 50_000, maxTxVolume: 500_000_000 },
    { window: '30d', maxTxCount: 200_000, maxTxVolume: 2_000_000_000 },
  ],
};

/**
 * Sample sanctions entries — REMOVED in P3-4 (H-8 fix).
 *
 * The 10-name hardcoded sample list used to live here. It has been moved
 * to `data/dev-sanctions-fixture.json` (a file, not source code) and is
 * loaded by `src/trust/sanctions-list-loader.ts`. Override the path with
 * the `PAYSWAP_SANCTIONS_LIST_FILE` env var to wire a real feed
 * (Chainalysis KYT / TRM Labs / Refinitiv World-Check One / Dow Jones
 * R&C) — no code change required.
 *
 * If you previously imported `SAMPLE_SANCTIONS_ENTRIES` from this module,
 * switch to `loadSanctionsList()` from `@/trust/sanctions-list-loader`.
 */

/**
 * Sample PEP entries used by `pep.ts` for simulated screening. In
 * production this is replaced by a managed PEP database (Refinitiv
 * World-Check, Dow Jones, LexisNexis Bridger).
 */
export const SAMPLE_PEP_ENTRIES: {
  name: string;
  pepType: Exclude<PEPType, 'none'>;
  country: string;
  position: string;
}[] = [
  { name: 'WILLIAM RUTO', pepType: 'head_of_state', country: 'Kenya', position: 'President of Kenya' },
  { name: 'NANA AKUFO-ADDO', pepType: 'head_of_state', country: 'Ghana', position: 'President of Ghana' },
  { name: 'BOLA TINUBU', pepType: 'head_of_state', country: 'Nigeria', position: 'President of Nigeria' },
  { name: 'CYRIL RAMAPHOSA', pepType: 'head_of_state', country: 'South Africa', position: 'President of South Africa' },
  { name: 'MUSA FAKI', pepType: 'senior_official', country: 'Tanzania', position: 'African Union Commission Chair' },
  { name: 'GENERAL MWANGI', pepType: 'military', country: 'Kenya', position: 'Chief of Defence Forces' },
  { name: 'JUSTICE OKELLO', pepType: 'judicial', country: 'Uganda', position: 'Supreme Court Justice' },
  { name: 'ETHEKWINI WATER BOARD', pepType: 'state_owned_enterprise', country: 'South Africa', position: 'SOE — public utility' },
];

/** Risk weighting per industry sector. */
export const INDUSTRY_RISK_WEIGHT: Record<string, number> = {
  retail: 5,
  food_beverage: 5,
  technology: 10,
  professional_services: 10,
  agriculture: 15,
  manufacturing: 15,
  logistics: 20,
  real_estate: 35,
  precious_metals: 50,
  gambling: 65,
  cryptocurrency_exchange: 70,
  money_service_business: 75,
  arms_dealing: 90,
  adult_entertainment: 55,
};
