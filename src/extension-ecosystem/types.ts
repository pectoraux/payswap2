/**
 * Extension Ecosystem — Production Types.
 *
 * Builds on the existing extension platform with: developer portal, registry,
 * runtime configuration + secrets, OAuth framework, billing, health monitoring,
 * marketplace quality score, and storefront.
 */

import type { ExtensionManifestV2, ExtensionBillingModel } from '@/extension-platform/types';

// ═══════════════════════════════════════════════════════════════════════════
// DEVELOPER PORTAL
// ═══════════════════════════════════════════════════════════════════════════

export interface DeveloperOrganization {
  id: string;
  name: string;
  slug: string;
  description: string;
  website?: string;
  logoUrl?: string;
  verified: boolean;
  createdAt: number;
  members: OrgMember[];
}

export interface OrgMember {
  userId: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'VIEWER';
  addedAt: number;
}

export interface Publisher {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string;
  website?: string;
  supportEmail?: string;
  verified: boolean;
  signingKeyIds: string[];
  publicKeys: Record<string, string>;
  createdAt: number;
  totalExtensions: number;
  totalInstalls: number;
  totalRevenue: number;
}

export interface ApiKey {
  id: string;
  orgId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface SigningCertificate {
  keyId: string;
  publicKey: string;
  label: string;
  createdAt: number;
  revokedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTENSION REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export type ReleaseChannel = 'STABLE' | 'BETA' | 'ALPHA' | 'CANARY' | 'NIGHTLY';

export interface RegistryVersion {
  extensionId: string;
  version: string;
  channel: ReleaseChannel;
  manifest: ExtensionManifestV2;
  checksum: string;
  changelog: string;
  publishedAt: number;
  deprecatedAt?: number;
  installs: number;
  activeInstalls: number;
  compatiblePaySwapVersions: { min: string; max: string };
}

export interface ExtensionRegistryEntry {
  extensionId: string;
  publisherId: string;
  publisherName: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  iconUrl?: string;
  screenshots: string[];
  documentationUrl?: string;
  homepage?: string;
  versions: RegistryVersion[];
  latestStable?: string;
  latestBeta?: string;
  channels: ReleaseChannel[];
  totalInstalls: number;
  activeInstalls: number;
  rating: number;
  reviewCount: number;
  qualityScore?: QualityScore;
  createdAt: number;
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// RUNTIME CONFIGURATION + SECRETS
// ═══════════════════════════════════════════════════════════════════════════

export interface ConfigSchema {
  fields: ConfigField[];
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'secret' | 'json';
  defaultValue?: unknown;
  required: boolean;
  description?: string;
  options?: string[];
  secret?: boolean;
  envOverride?: boolean;
}

export interface ExtensionConfig {
  extensionId: string;
  tenantId: string;
  values: Record<string, unknown>;
  featureFlags: Record<string, boolean>;
  updatedAt: number;
}

export interface StoredSecret {
  id: string;
  extensionId: string;
  tenantId: string;
  key: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
  createdAt: number;
  rotatedAt?: number;
  rotationDays?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// OAUTH FRAMEWORK
// ═══════════════════════════════════════════════════════════════════════════

export type OAuthProvider =
  | 'google' | 'microsoft' | 'github' | 'slack' | 'stripe'
  | 'twilio' | 'aws' | 'azure' | 'shopify' | 'generic';

export interface OAuthConfig {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: string;
  authUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
}

export interface OAuthTokenSet {
  extensionId: string;
  tenantId: string;
  provider: OAuthProvider;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope: string[];
  obtainedAt: number;
}

export interface OAuthSession {
  id: string;
  extensionId: string;
  tenantId: string;
  provider: OAuthProvider;
  state: string;
  codeVerifier?: string;
  redirectUri: string;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// BILLING
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtensionSubscription {
  id: string;
  extensionId: string;
  tenantId: string;
  billingModel: ExtensionBillingModel;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';
  priceMinorUnits: number;
  currency: string;
  interval?: 'MONTHLY' | 'YEARLY';
  trialEndsAt?: number;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelledAt?: number;
  usageRecords: UsageRecord[];
  createdAt: number;
}

export interface UsageRecord {
  id: string;
  subscriptionId: string;
  metric: string;
  quantity: number;
  unitPrice: number;
  timestamp: number;
}

export interface BillingInvoice {
  id: string;
  tenantId: string;
  subscriptionId: string;
  extensionId: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  lineItems: BillingLineItem[];
  periodStart: number;
  periodEnd: number;
  paidAt?: number;
  createdAt: number;
}

export interface BillingLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH + OBSERVABILITY
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtensionHealthRecord {
  extensionId: string;
  tenantId: string;
  healthy: boolean;
  checks: Array<{ id: string; name: string; healthy: boolean; detail: string; latencyMs: number }>;
  uptime: number;
  lastCheckAt: number;
}

export interface ExtensionMetrics {
  extensionId: string;
  tenantId: string;
  invocations: number;
  successfulInvocations: number;
  failedInvocations: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  memoryUsageMb: number;
  cpuUsageMs: number;
  errorRate: number;
  throughputPerMin: number;
  revenue: number;
  cost: number;
  profit: number;
  capabilityUsage: Record<string, number>;
  plannerDecisions: number;
  eventsEmitted: number;
  collectedAt: number;
}

export interface ExtensionLogEntry {
  id: string;
  extensionId: string;
  tenantId: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  meta?: Record<string, unknown>;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUALITY SCORE
// ═══════════════════════════════════════════════════════════════════════════

export interface QualityScore {
  extensionId: string;
  version: string;
  overall: number;
  security: number;
  performance: number;
  availability: number;
  supportQuality: number;
  documentation: number;
  merchantSatisfaction: number;
  installSuccess: number;
  plannerCompatibility: number;
  capabilityReuse: number;
  economicEfficiency: number;
  resourceConsumption: number;
  updateFrequency: number;
  computedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// STOREFRONT
// ═══════════════════════════════════════════════════════════════════════════

export type StorefrontSection =
  | 'FEATURED' | 'TRENDING' | 'MOST_INSTALLED' | 'BEST_RATED'
  | 'RECENTLY_UPDATED' | 'NEW' | 'COLLECTIONS' | 'INDUSTRIES';

export interface StorefrontListing {
  extensionId: string;
  name: string;
  publisherName: string;
  description: string;
  category: string;
  tags: string[];
  iconUrl?: string;
  version: string;
  installCount: number;
  rating: number;
  reviewCount: number;
  qualityScore: number;
  billingModel: string;
  featured: boolean;
  trending: boolean;
  updatedAt: number;
}

export interface ExtensionBundle {
  id: string;
  name: string;
  description: string;
  extensions: string[];
  compatible: boolean;
  conflicts: string[];
  sharedPermissions: string[];
  discountPercent?: number;
  createdAt: number;
}

export interface ExtensionReview {
  id: string;
  extensionId: string;
  version: string;
  tenantId: string;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  createdAt: number;
  publisherReply?: string;
  publisherReplyAt?: number;
}
