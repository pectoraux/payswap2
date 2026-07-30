/**
 * Extension Platform — Type Definitions.
 *
 * Production-grade extension manifest, package, permissions, and lifecycle
 * types. Transforms extensions into installable software packages.
 *
 * Integrates with: EKG (extensions register as entities), Capability Graph
 * (extensions offer capabilities), Provider Registry (extensions can be
 * providers), resolve() (extensions are discovered automatically), Event
 * Sourcing (installation is event-sourced), Money (billing is exact).
 */

import type { EntityLabel } from '@/ekg/types';

// ═══════════════════════════════════════════════════════════════════════════
// SEMANTIC VERSIONING
// ═══════════════════════════════════════════════════════════════════════════

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;        // e.g. 'beta.1'
  build?: string;             // e.g. 'exp.sha.5114f85'
}

export function parseSemVer(v: string): SemVer {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?(?:\+([a-zA-Z0-9.]+))?$/);
  if (!m) throw new Error(`Invalid semver: ${v}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4], build: m[5] };
}

export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) return a.prerelease < b.prerelease ? -1 : a.prerelease > b.prerelease ? 1 : 0;
  return 0;
}

export function semVerToString(v: SemVer): string {
  let s = `${v.major}.${v.minor}.${v.patch}`;
  if (v.prerelease) s += `-${v.prerelease}`;
  if (v.build) s += `+${v.build}`;
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTENSION MANIFEST v2
// ═══════════════════════════════════════════════════════════════════════════

export type ExtensionCategory =
  | 'PAYMENTS' | 'IDENTITY' | 'LENDING' | 'MARKETPLACE' | 'INSURANCE'
  | 'COMPLIANCE' | 'LOGISTICS' | 'HEALTHCARE' | 'EDUCATION' | 'AI'
  | 'ANALYTICS' | 'NOTIFICATIONS' | 'STORAGE' | 'CARBON' | 'TREASURY'
  | 'DEVELOPER_TOOLS' | 'GOVERNMENT' | 'CUSTOM';

export type PermissionScope =
  | 'payments' | 'wallet' | 'identity' | 'notifications' | 'messaging'
  | 'storage' | 'analytics' | 'marketplace' | 'treasury' | 'orders'
  | 'customers' | 'providers' | 'graph' | 'memory' | 'policies'
  | 'money' | 'admin_ui' | 'events' | 'tokens' | 'resolve';

export type PermissionAccess = 'read' | 'write' | 'admin';

export interface PermissionRequest {
  scope: PermissionScope;
  access: PermissionAccess;
  reason: string;             // human-readable justification
}

export interface ExtensionDependency {
  id: string;                 // extension id
  versionRange: string;       // e.g. '^1.0.0', '>=2.0.0 <3.0.0'
  optional?: boolean;
}

export interface ExtensionConflict {
  id: string;
  versionRange?: string;
  reason: string;
}

export interface ExtensionCapabilityContribution {
  name: string;
  description: string;
  category: string;
  produces: string[];         // asset type ids
  requires: string[];
  universal?: boolean;
}

export interface ExtensionAssetContribution {
  id: string;
  name: string;
  type: string;               // CURRENCY, CREDENTIAL, RECEIPT, etc.
  unit: string;
  description: string;
}

export interface ExtensionTokenContribution {
  symbol: string;
  name: string;
  assetId: string;
  kind: 'FUNGIBLE' | 'NON_FUNGIBLE' | 'SOULBOUND';
  consumable: boolean;
}

export interface ExtensionEventContribution {
  type: 'emits' | 'consumes';
  eventType: string;
  description?: string;
}

export interface ExtensionUIContribution {
  type: 'nav' | 'page' | 'settings' | 'admin' | 'widget';
  label: string;
  path: string;
  icon?: string;
  group?: string;
  order?: number;
}

export interface ExtensionMigration {
  version: string;
  up: string;                 // SQL or migration script reference
  down: string;               // rollback
}

export interface ExtensionRouteContribution {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  handler: string;            // function reference in the compiled code
  authRequired: boolean;
  permissions?: PermissionScope[];
}

export interface ExtensionScheduledJob {
  id: string;
  name: string;
  schedule: string;           // cron expression
  handler: string;
}

export interface ExtensionHealthCheck {
  id: string;
  name: string;
  handler: string;
  timeoutMs: number;
}

export interface ExtensionCompatibility {
  minPaySwapVersion: string;
  maxTestedPaySwapVersion: string;
  breakingChanges?: string;   // from previous major version
  upgradeNotes?: string;
  rollbackNotes?: string;
}

export interface ExtensionProviderContribution {
  id: string;
  name: string;
  label: EntityLabel;
  description: string;
  capabilities: string[];     // capability names
  jurisdictions: string[];
  carbonPerInvocation: number;
}

/**
 * The Extension Manifest v2 — production schema.
 */
export interface ExtensionManifestV2 {
  // ── Identity ──
  id: string;                 // e.g. 'parcel-delivery'
  name: string;
  version: string;            // semver
  publisher: {
    id: string;
    name: string;
    email: string;
    website?: string;
    verified: boolean;
  };
  description: string;
  homepage?: string;
  license: string;            // SPDX identifier
  repository?: string;
  documentationUrl?: string;
  supportUrl?: string;
  category: ExtensionCategory;
  tags: string[];
  screenshots?: string[];     // URLs

  // ── Contributions (what the extension provides to the platform) ──
  capabilities: ExtensionCapabilityContribution[];
  assets: ExtensionAssetContribution[];
  tokens: ExtensionTokenContribution[];
  events: ExtensionEventContribution[];
  providers: ExtensionProviderContribution[];
  policies?: Array<{ name: string; rule: string; enforcement: 'BLOCK' | 'WARN' | 'REQUIRE_APPROVAL'; description: string }>;
  routes: ExtensionRouteContribution[];
  ui: ExtensionUIContribution[];
  scheduledJobs: ExtensionScheduledJob[];
  healthChecks: ExtensionHealthCheck[];
  migrations: ExtensionMigration[];

  // ── Dependencies ──
  dependencies: ExtensionDependency[];
  conflicts: ExtensionConflict[];
  provides?: string[];        // capability ids this extension provides (for dependency resolution)

  // ── Permissions ──
  permissions: PermissionRequest[];

  // ── Compatibility ──
  compatibility: ExtensionCompatibility;

  // ── Billing ──
  billing?: ExtensionBillingPlan;

  // ── Metadata ──
  createdAt: number;
  updatedAt: number;
}

export type ExtensionBillingModel =
  | 'FREE' | 'ONE_TIME' | 'SUBSCRIPTION' | 'USAGE_BASED' | 'REVENUE_SHARE' | 'ENTERPRISE';

export interface ExtensionBillingPlan {
  model: ExtensionBillingModel;
  price?: number;             // in USD (exact — use Money in execution)
  currency?: string;
  interval?: 'MONTHLY' | 'YEARLY';
  trialDays?: number;
  revenueSharePercent?: number; // for REVENUE_SHARE
  usageMetric?: string;        // for USAGE_BASED (e.g. 'per_transaction', 'per_api_call')
  usagePrice?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTENSION PACKAGE (.psx)
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtensionPackage {
  /** The manifest. */
  manifest: ExtensionManifestV2;
  /** The compiled code (as a string reference — in production this is a bundle). */
  code: string;
  /** Static assets (key → content). */
  assets: Record<string, string>;
  /** Schemas (JSON schema references). */
  schemas: Record<string, unknown>;
  /** The package checksums. */
  checksums: PackageChecksums;
  /** The cryptographic signature. */
  signature: PackageSignature;
  /** When the package was built. */
  builtAt: number;
}

export interface PackageChecksums {
  manifestSha256: string;
  codeSha256: string;
  assetsSha256: string;
  totalSha256: string;        // hash of all the above
}

export interface PackageSignature {
  /** The publisher's public key (PEM format). */
  publicKey: string;
  /** The signature of the totalSha256 checksum. */
  signature: string;
  /** The algorithm used. */
  algorithm: 'RSA-SHA256' | 'ECDSA-SHA256';
  /** When the package was signed. */
  signedAt: number;
  /** The publisher key ID (fingerprint of the public key). */
  keyId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// INSTALLATION LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

export type InstallStatus =
  | 'PENDING' | 'DOWNLOADING' | 'VERIFYING' | 'RESOLVING_DEPS'
  | 'INSTALLING' | 'MIGRATING' | 'REGISTERING' | 'ACTIVATING'
  | 'ACTIVE' | 'FAILED' | 'ROLLED_BACK' | 'DISABLED' | 'UNINSTALLED';

export type UpgradeType = 'PATCH' | 'MINOR' | 'MAJOR';

export interface InstalledExtension {
  id: string;                 // extension id
  version: string;            // installed version
  status: InstallStatus;
  /** The tenant (organization) that installed this extension. */
  tenantId: string;
  /** Permissions that were approved. */
  approvedPermissions: PermissionRequest[];
  /** Installation timestamp. */
  installedAt: number;
  /** Last updated timestamp. */
  updatedAt: number;
  /** The entity node id in the EKG (extensions register as entities). */
  ekgEntityId?: string;
  /** Installation log. */
  log: InstallLogEntry[];
  /** Previous version (for rollback). */
  previousVersion?: string;
}

export interface InstallLogEntry {
  step: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  detail: string;
  ts: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE
// ═══════════════════════════════════════════════════════════════════════════

export type MarketplaceStatus =
  | 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'PUBLISHED' | 'DEPRECATED' | 'UNPUBLISHED';

export type ReviewStage =
  | 'MANIFEST_VALIDATION' | 'DEPENDENCY_VALIDATION' | 'SECURITY_SCAN'
  | 'POLICY_VALIDATION' | 'PERFORMANCE_BENCHMARK' | 'ECONOMIC_SIMULATION'
  | 'STATIC_ANALYSIS' | 'SIGNATURE_VALIDATION' | 'COMPATIBILITY_TEST'
  | 'HUMAN_REVIEW';

export type ReviewStageResult = 'PENDING' | 'PASS' | 'FAIL' | 'WARN';

export interface ReviewStageRecord {
  stage: ReviewStage;
  result: ReviewStageResult;
  detail: string;
  durationMs: number;
  ts: number;
}

export interface MarketplaceSubmission {
  id: string;
  extensionId: string;
  extensionName: string;
  version: string;
  publisherId: string;
  publisherName: string;
  status: MarketplaceStatus;
  reviewStages: ReviewStageRecord[];
  packageChecksum: string;
  submittedAt: number;
  reviewedAt?: number;
  publishedAt?: number;
  rejectionReason?: string;
  downloads: number;
  rating: number;             // 0–5
  reviewCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// RUNTIME ISOLATION
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtensionRuntimeLimits {
  cpuMs: number;              // max CPU time per invocation
  memoryMb: number;           // max memory
  executionTimeoutMs: number; // max wall-clock time
  storageQuotaMb: number;     // max storage
  networkAllowed: boolean;    // can make external network calls
  networkWhitelist?: string[];// allowed domains
}

export interface ExtensionRuntimeStats {
  extensionId: string;
  invocations: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  memoryUsageMb: number;
  cpuUsageMs: number;
  errorCount: number;
  lastInvocationAt?: number;
  revenue: number;            // in USD (exact — Money in execution)
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTENSION OBSERVABILITY
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtensionHealth {
  extensionId: string;
  healthy: boolean;
  checks: Array<{ id: string; name: string; healthy: boolean; detail: string; latencyMs: number }>;
  uptime: number;             // 0–1
  lastCheckAt: number;
}
