/**
 * PaySwap Cloud — Core Types. (M-CLOUD-44.)
 *
 * PaySwap Cloud is the multi-tenant cloud platform. An organization,
 * government, or developer can create a Cloud Tenant — which provisions an
 * isolated PaySwap instance running on the shared kernel. Each tenant has its
 * own members, programs, deployments, billing subscription, and audit log.
 *
 * The Cloud layer sits ABOVE the runtime kernel and BESIDE the Identity OS
 * and Capability SDK. It does NOT modify the frozen kernel. It maintains an
 * in-memory store (mirroring the SDK + Identity OS pattern) so the cloud
 * console can demo out of the box.
 *
 * Topology:
 *
 *   CloudTenant (an organization on the cloud)
 *     ├── members (users with role: owner/admin/developer/operator/viewer)
 *     ├── programs (initiatives within the tenant — e.g. "Ghana Expansion")
 *     ├── deployments (isolated PaySwap instances — sandbox/staging/prod)
 *     ├── subscription (billing — plan + usage-based charges)
 *     └── audit log (who did what, when)
 *
 * Constraints: in-memory maps only (do NOT modify Prisma schema). The
 * `ownerId` on a tenant points back to the underlying Prisma User row.
 */

// ─── Tenant ──────────────────────────────────────────────────────────────────

/**
 * A Cloud Tenant is an organization that runs on PaySwap Cloud. Each tenant
 * gets its own isolated deployment of the PaySwap kernel.
 */
export interface CloudTenant {
  id: string;
  name: string;
  slug: string; // URL-safe identifier (unique)
  type: CloudTenantType;
  plan: CloudPlan;
  region: string; // deployment region (e.g. 'af-west-1', 'eu-central-1')
  status: CloudTenantStatus;
  ownerId: string; // User ID of the tenant owner
  createdAt: number;
  members: CloudTenantMember[];
  config: CloudTenantConfig;
  usage: CloudUsage;
  // Lifecycle timestamps
  suspendedAt?: number;
  suspendedReason?: string;
  terminatedAt?: number;
  terminatedReason?: string;
}

export type CloudTenantType =
  | 'organization'
  | 'government'
  | 'developer_org'
  | 'enterprise';

export type CloudPlan = 'free' | 'starter' | 'growth' | 'scale' | 'enterprise';

export type CloudTenantStatus = 'active' | 'suspended' | 'terminated';

export interface CloudTenantMember {
  id: string;
  tenantId: string;
  userId: string;
  role: CloudTenantRole;
  invitedAt: number;
  joinedAt?: number;
  invitedBy?: string;
}

export type CloudTenantRole =
  | 'owner'
  | 'admin'
  | 'developer'
  | 'operator'
  | 'viewer';

export interface CloudTenantConfig {
  // What capabilities this tenant has access to
  features: string[]; // ['payments', 'payouts', 'lp', 'treasury', ...]
  // Resource limits
  limits: CloudTenantLimits;
  // Custom branding
  branding?: {
    logoUrl?: string;
    primaryColor?: string;
    domain?: string; // custom domain
  };
  // Compliance region
  complianceRegion: CloudComplianceRegion;
}

export type CloudComplianceRegion = 'GH' | 'NG' | 'KE' | 'EU' | 'US' | 'GLOBAL';

export interface CloudTenantLimits {
  maxMerchants: number;
  maxLPs: number;
  maxTransactionsPerMonth: number;
  maxAPIRequestsPerMinute: number;
  maxStorageGB: number;
  maxExtensions: number;
}

export interface CloudUsage {
  merchants: number;
  lps: number;
  transactionsThisMonth: number;
  apiRequestsThisMinute: number;
  storageUsedGB: number;
  extensionsInstalled: number;
  lastResetAt: number;
}

// ─── Program ─────────────────────────────────────────────────────────────────

/**
 * A Cloud Program is a specific initiative within a tenant
 * (e.g., "Ghana Expansion", "Mobile Money Pilot").
 */
export interface CloudProgram {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  status: CloudProgramStatus;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  // Lifecycle timestamps
  pausedAt?: number;
  archivedAt?: number;
}

export type CloudProgramStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';

// ─── Deployment ──────────────────────────────────────────────────────────────

/**
 * Cloud deployment — each tenant gets its own isolated deployment of the
 * PaySwap kernel running in sandbox / staging / production.
 */
export interface CloudDeployment {
  id: string;
  tenantId: string;
  environment: CloudDeploymentEnvironment;
  region: string;
  status: CloudDeploymentStatus;
  version: string; // PaySwap kernel version
  url: string; // deployment URL
  deployedAt: number;
  health: CloudDeploymentHealth;
  // Recent logs (bounded ring buffer)
  logs: CloudLogEntry[];
  // Metadata
  config: {
    replicas: number;
    cpuMillicores: number;
    memoryMB: number;
    storageGB: number;
  };
}

export type CloudDeploymentEnvironment =
  | 'sandbox'
  | 'staging'
  | 'production';

export type CloudDeploymentStatus =
  | 'running'
  | 'deploying'
  | 'stopped'
  | 'failed';

export type CloudDeploymentHealth = 'healthy' | 'degraded' | 'down';

export interface CloudLogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

// ─── Billing ─────────────────────────────────────────────────────────────────

export interface CloudSubscription {
  id: string;
  tenantId: string;
  plan: CloudPlan;
  status: CloudSubscriptionStatus;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  amount: number; // base plan amount (monthly)
  currency: string;
  usageBasedCharges: UsageBasedCharge[];
  createdAt: number;
  canceledAt?: number;
  cancelReason?: string;
}

export type CloudSubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled';

export interface UsageBasedCharge {
  type: UsageBasedChargeType;
  quantity: number;
  rate: number; // per-unit rate
  amount: number; // quantity * rate
}

export type UsageBasedChargeType =
  | 'transactions'
  | 'api_calls'
  | 'storage'
  | 'extensions';

export interface CloudInvoice {
  id: string;
  tenantId: string;
  subscriptionId: string;
  periodStart: number;
  periodEnd: number;
  amount: number;
  currency: string;
  lineItems: UsageBasedCharge[];
  status: 'paid' | 'open' | 'void';
  createdAt: number;
}

// ─── Audit ───────────────────────────────────────────────────────────────────

/**
 * Cloud audit log (separate from the runtime audit log). Tracks every
 * administrative action on a tenant: member changes, deployments, billing
 * changes, program lifecycle, configuration updates.
 */
export interface CloudAuditEntry {
  id: string;
  tenantId: string;
  actorId: string;
  action: string; // e.g. 'tenant.created', 'member.added', 'deployment.deployed'
  resourceId: string;
  resourceType: string; // e.g. 'tenant', 'member', 'deployment', 'program'
  details: Record<string, unknown>;
  timestamp: number;
}

// ─── Plan catalogue ──────────────────────────────────────────────────────────

/**
 * Static definition of each plan. Used by the TenantManager and BillingManager
 * to look up limits, prices, and features for a given plan. The landing page
 * (`/cloud`) also reads from this catalogue for the pricing section.
 */
export interface CloudPlanDefinition {
  id: CloudPlan;
  name: string;
  priceMonthly: number;
  currency: string;
  tagline: string;
  limits: CloudTenantLimits;
  features: string[];
  highlighted?: boolean;
}

export const CLOUD_PLAN_CATALOGUE: CloudPlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    currency: 'USD',
    tagline: 'For evaluation & local development',
    limits: {
      maxMerchants: 1,
      maxLPs: 1,
      maxTransactionsPerMonth: 1000,
      maxAPIRequestsPerMinute: 60,
      maxStorageGB: 1,
      maxExtensions: 3,
    },
    features: ['payments', 'payouts', 'sandbox'],
  },
  {
    id: 'starter',
    name: 'Starter',
    priceMonthly: 99,
    currency: 'USD',
    tagline: 'For small merchants & fintech pilots',
    limits: {
      maxMerchants: 10,
      maxLPs: 5,
      maxTransactionsPerMonth: 25_000,
      maxAPIRequestsPerMinute: 300,
      maxStorageGB: 25,
      maxExtensions: 10,
    },
    features: ['payments', 'payouts', 'lp', 'treasury', 'extensions', 'sandbox', 'support_standard'],
  },
  {
    id: 'growth',
    name: 'Growth',
    priceMonthly: 499,
    currency: 'USD',
    tagline: 'For scaling fintechs & PSPs',
    highlighted: true,
    limits: {
      maxMerchants: 100,
      maxLPs: 25,
      maxTransactionsPerMonth: 250_000,
      maxAPIRequestsPerMinute: 1500,
      maxStorageGB: 250,
      maxExtensions: 50,
    },
    features: ['payments', 'payouts', 'lp', 'treasury', 'extensions', 'sandbox', 'staging', 'production', 'support_priority', 'compliance_aml', 'compliance_kyc'],
  },
  {
    id: 'scale',
    name: 'Scale',
    priceMonthly: 1999,
    currency: 'USD',
    tagline: 'For enterprises & governments',
    limits: {
      maxMerchants: 1000,
      maxLPs: 100,
      maxTransactionsPerMonth: 2_500_000,
      maxAPIRequestsPerMinute: 10_000,
      maxStorageGB: 2500,
      maxExtensions: 250,
    },
    features: ['payments', 'payouts', 'lp', 'treasury', 'extensions', 'sandbox', 'staging', 'production', 'support_dedicated', 'compliance_aml', 'compliance_kyc', 'compliance_travel_rule', 'multi_region', 'custom_domain'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    priceMonthly: 0, // contact sales
    currency: 'USD',
    tagline: 'For sovereign cloud & central banks',
    limits: {
      maxMerchants: 100_000,
      maxLPs: 1000,
      maxTransactionsPerMonth: 100_000_000,
      maxAPIRequestsPerMinute: 100_000,
      maxStorageGB: 50_000,
      maxExtensions: 10_000,
    },
    features: ['payments', 'payouts', 'lp', 'treasury', 'extensions', 'sandbox', 'staging', 'production', 'support_dedicated', 'compliance_aml', 'compliance_kyc', 'compliance_travel_rule', 'multi_region', 'custom_domain', 'sovereign_cloud', 'air_gap', 'custom_compliance'],
  },
];

export function getPlanDefinition(plan: CloudPlan): CloudPlanDefinition {
  return CLOUD_PLAN_CATALOGUE.find((p) => p.id === plan) ?? CLOUD_PLAN_CATALOGUE[0];
}

// ─── Usage rate card ─────────────────────────────────────────────────────────

/**
 * Per-unit rates for usage-based charges (applied on top of the plan's
 * base monthly fee). Used by the BillingManager when computing invoices.
 */
export const USAGE_RATE_CARD: Record<UsageBasedChargeType, { rate: number; included: number }> = {
  // $0.01 per transaction over the included allowance
  transactions: { rate: 0.01, included: 0 },
  // $0.0001 per API call (effectively $0.10 per 1k calls)
  api_calls: { rate: 0.0001, included: 0 },
  // $0.10 per GB / month for storage over the included allowance
  storage: { rate: 0.1, included: 0 },
  // $5 per extension installed above the free tier
  extensions: { rate: 5, included: 0 },
};

// ─── Region catalogue ────────────────────────────────────────────────────────

export interface CloudRegion {
  id: string;
  label: string;
  country: string;
  complianceRegion: CloudComplianceRegion;
  latencyMs: number; // representative latency from origin
}

export const CLOUD_REGIONS: CloudRegion[] = [
  { id: 'af-west-1', label: 'Africa West (Accra)', country: 'Ghana', complianceRegion: 'GH', latencyMs: 12 },
  { id: 'af-east-1', label: 'Africa East (Nairobi)', country: 'Kenya', complianceRegion: 'KE', latencyMs: 28 },
  { id: 'af-south-1', label: 'Africa South (Lagos)', country: 'Nigeria', complianceRegion: 'NG', latencyMs: 35 },
  { id: 'eu-central-1', label: 'Europe Central (Frankfurt)', country: 'Germany', complianceRegion: 'EU', latencyMs: 95 },
  { id: 'eu-west-1', label: 'Europe West (Dublin)', country: 'Ireland', complianceRegion: 'EU', latencyMs: 110 },
  { id: 'us-east-1', label: 'US East (Virginia)', country: 'United States', complianceRegion: 'US', latencyMs: 145 },
  { id: 'us-west-1', label: 'US West (Oregon)', country: 'United States', complianceRegion: 'US', latencyMs: 165 },
  { id: 'global', label: 'Global (anycast)', country: 'Global', complianceRegion: 'GLOBAL', latencyMs: 60 },
];

export function getRegion(regionId: string): CloudRegion | undefined {
  return CLOUD_REGIONS.find((r) => r.id === regionId);
}

// ─── Overview (for dashboard) ────────────────────────────────────────────────

export interface CloudOverview {
  totalTenants: number;
  byType: Record<CloudTenantType, number>;
  byPlan: Record<CloudPlan, number>;
  byStatus: Record<CloudTenantStatus, number>;
  totalMembers: number;
  totalPrograms: number;
  totalDeployments: number;
  totalSubscriptions: number;
  totalMrr: number; // monthly recurring revenue (sum of base plan amounts)
  currency: string;
}
