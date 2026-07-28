/**
 * PaySwap Cloud — in-memory store. (M-CLOUD-44.)
 *
 * Single process-wide singleton that holds the tenant, member, program,
 * deployment, subscription, invoice, and audit records. Mirrors the
 * Identity OS / SDK pattern: stored on `globalThis.__PAYSWAP_CLOUD_STORE__`
 * so Next.js dev-mode module re-instantiation does not lose data.
 *
 * We deliberately do NOT touch the Prisma schema (constraint: do not modify
 * `prisma/schema.prisma`). Cloud records are an in-memory representation
 * OVER the existing Organization / User tables — `ownerId` and `userId`
 * point back to the underlying Prisma rows.
 */

import type {
  CloudTenant,
  CloudProgram,
  CloudDeployment,
  CloudSubscription,
  CloudInvoice,
  CloudAuditEntry,
} from './types';
import { uid } from '@/runtime/types';

// ─── Store shape ────────────────────────────────────────────────────────────

export interface CloudStore {
  // tenantId → tenant
  tenants: Map<string, CloudTenant>;
  // slug → tenantId (unique slug index)
  slugIndex: Map<string, string>;
  // userId → tenantId[] (reverse index for "listForUser")
  userTenants: Map<string, Set<string>>;
  // programId → program
  programs: Map<string, CloudProgram>;
  // deploymentId → deployment
  deployments: Map<string, CloudDeployment>;
  // tenantId → subscription (one active subscription per tenant)
  subscriptions: Map<string, CloudSubscription>;
  // invoiceId → invoice
  invoices: Map<string, CloudInvoice>;
  // auditId → entry (also referenced from per-tenant arrays)
  audit: Map<string, CloudAuditEntry>;
}

function createStore(): CloudStore {
  return {
    tenants: new Map(),
    slugIndex: new Map(),
    userTenants: new Map(),
    programs: new Map(),
    deployments: new Map(),
    subscriptions: new Map(),
    invoices: new Map(),
    audit: new Map(),
  };
}

const globalForCloud = globalThis as unknown as {
  __PAYSWAP_CLOUD_STORE__?: CloudStore;
  __PAYSWAP_CLOUD_SEEDED__?: boolean;
};

export const store: CloudStore =
  globalForCloud.__PAYSWAP_CLOUD_STORE__ ?? createStore();

if (!globalForCloud.__PAYSWAP_CLOUD_STORE__) {
  globalForCloud.__PAYSWAP_CLOUD_STORE__ = store;
}

// ─── Slug helper ────────────────────────────────────────────────────────────

/**
 * Convert a tenant name to a URL-safe slug. Lowercase, hyphens between words,
 * strips non-alphanumeric characters. Appends a short random suffix when the
 * slug is already taken so `create()` never fails due to a collision.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'tenant';
}

export function uniqueSlug(desired: string): string {
  const base = slugify(desired);
  let candidate = base;
  let n = 2;
  while (store.slugIndex.has(candidate)) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

// ─── ID helpers ─────────────────────────────────────────────────────────────

export const ids = {
  tenant: () => uid('tnt'),
  member: () => uid('tntm'),
  program: () => uid('prog'),
  deployment: () => uid('dep'),
  subscription: () => uid('sub'),
  invoice: () => uid('inv'),
  audit: () => uid('caud'),
};

// ─── Seed ───────────────────────────────────────────────────────────────────
//
// Seed the Cloud store with a representative mix of tenants so the admin
// cloud console has something to show out of the box. We DON'T require any
// existing Prisma rows — the seed creates standalone tenants with
// `ownerId: 'seed-*'` for demo purposes. When the Cloud is wired into the
// actual onboarding flow, real tenants will be created via the
// `TenantManager.create()` method with `ownerId` set to a real User.id.

export function seedCloudStore(): void {
  if (globalForCloud.__PAYSWAP_CLOUD_SEEDED__) return;
  globalForCloud.__PAYSWAP_CLOUD_SEEDED__ = true;

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // Representative owner IDs (these would be User rows in production).
  const OWNER_ACCRA = 'seed-user-accra';
  const OWNER_BOG = 'seed-user-bog';
  const OWNER_LAGOS = 'seed-user-lagos';
  const OWNER_DEV = 'seed-user-dev';
  const OWNER_NAIROBI = 'seed-user-nairobi';

  type TenantSeed = {
    name: string;
    slug: string;
    type: CloudTenant['type'];
    plan: CloudTenant['plan'];
    region: string;
    ownerId: string;
    complianceRegion: CloudTenant['config']['complianceRegion'];
    status?: CloudTenant['status'];
    usage?: Partial<CloudTenant['usage']>;
    extraMembers?: Array<{ userId: string; role: CloudTenant['members'][number]['role'] }>;
    programs?: Array<{ name: string; description: string; status: CloudProgram['status'] }>;
    deployments?: Array<{ environment: CloudDeployment['environment']; status?: CloudDeployment['status']; health?: CloudDeployment['health'] }>;
    brandColor?: string;
  };

  const seeds: TenantSeed[] = [
    {
      name: 'Accra Fintech Hub',
      slug: 'accra-fintech-hub',
      type: 'organization',
      plan: 'growth',
      region: 'af-west-1',
      ownerId: OWNER_ACCRA,
      complianceRegion: 'GH',
      usage: { merchants: 38, lps: 6, transactionsThisMonth: 84_200, apiRequestsThisMinute: 412, storageUsedGB: 78, extensionsInstalled: 14 },
      extraMembers: [
        { userId: 'seed-user-kofi', role: 'admin' },
        { userId: 'seed-user-akosua', role: 'developer' },
        { userId: 'seed-user-yaw', role: 'operator' },
      ],
      programs: [
        { name: 'Mobile Money Expansion', description: 'Roll out MTN + Vodafone + AirtelTigo mobile money across Ghana.', status: 'active' },
        { name: 'Remittance Corridor Pilot', description: 'UK → Ghana remittance corridor with stablecoin settlement.', status: 'active' },
        { name: 'Merchant Onboarding v2', description: 'Self-serve merchant onboarding with KYC automation.', status: 'paused' },
      ],
      deployments: [
        { environment: 'production', status: 'running', health: 'healthy' },
        { environment: 'staging', status: 'running', health: 'healthy' },
        { environment: 'sandbox', status: 'running', health: 'degraded' },
      ],
      brandColor: '#10b981',
    },
    {
      name: 'Bank of Ghana — Fintech Sandbox',
      slug: 'bank-of-ghana-sandbox',
      type: 'government',
      plan: 'enterprise',
      region: 'af-west-1',
      ownerId: OWNER_BOG,
      complianceRegion: 'GH',
      usage: { merchants: 120, lps: 22, transactionsThisMonth: 1_240_000, apiRequestsThisMinute: 5_200, storageUsedGB: 870, extensionsInstalled: 35 },
      extraMembers: [
        { userId: 'seed-user-bog-1', role: 'admin' },
        { userId: 'seed-user-bog-2', role: 'operator' },
        { userId: 'seed-user-bog-3', role: 'viewer' },
      ],
      programs: [
        { name: 'Regulatory Sandbox Cohort 3', description: 'Cohort 3 of the Bank of Ghana regulatory sandbox for fintech innovators.', status: 'active' },
        { name: 'CBDC Pilot — eCedi', description: 'Central bank digital currency pilot integrated with PaySwap settlement rails.', status: 'active' },
      ],
      deployments: [
        { environment: 'production', status: 'running', health: 'healthy' },
        { environment: 'sandbox', status: 'running', health: 'healthy' },
      ],
      brandColor: '#7c3aed',
    },
    {
      name: 'Lagos PSP Collective',
      slug: 'lagos-psp-collective',
      type: 'enterprise',
      plan: 'scale',
      region: 'af-south-1',
      ownerId: OWNER_LAGOS,
      complianceRegion: 'NG',
      usage: { merchants: 240, lps: 18, transactionsThisMonth: 487_000, apiRequestsThisMinute: 2_400, storageUsedGB: 410, extensionsInstalled: 22 },
      extraMembers: [
        { userId: 'seed-user-ngozi', role: 'admin' },
        { userId: 'seed-user-ade', role: 'developer' },
      ],
      programs: [
        { name: 'Naira Stablecoin Onboarding', description: 'Onboard 100 merchants to USDT/USDC settlement via PaySwap.', status: 'active' },
        { name: 'Sanctions Screening Upgrade', description: 'Migrate to real-time sanctions screening across all corridors.', status: 'completed' },
      ],
      deployments: [
        { environment: 'production', status: 'running', health: 'degraded' },
        { environment: 'staging', status: 'stopped', health: 'down' },
      ],
      brandColor: '#f59e0b',
    },
    {
      name: 'Dev Sandbox — Kwame',
      slug: 'dev-sandbox-kwame',
      type: 'developer_org',
      plan: 'free',
      region: 'af-west-1',
      ownerId: OWNER_DEV,
      complianceRegion: 'GH',
      usage: { merchants: 1, lps: 0, transactionsThisMonth: 320, apiRequestsThisMinute: 12, storageUsedGB: 0.4, extensionsInstalled: 2 },
      programs: [
        { name: 'Personal Sandbox', description: 'Local development tenant for testing PaySwap APIs.', status: 'active' },
      ],
      deployments: [
        { environment: 'sandbox', status: 'running', health: 'healthy' },
      ],
      brandColor: '#0ea5e9',
    },
    {
      name: 'Nairobi M-Pesa Pilot',
      slug: 'nairobi-mpesa-pilot',
      type: 'organization',
      plan: 'starter',
      region: 'af-east-1',
      ownerId: OWNER_NAIROBI,
      complianceRegion: 'KE',
      status: 'suspended',
      usage: { merchants: 7, lps: 1, transactionsThisMonth: 3_120, apiRequestsThisMinute: 0, storageUsedGB: 4.1, extensionsInstalled: 3 },
      extraMembers: [
        { userId: 'seed-user-wanjiku', role: 'developer' },
      ],
      programs: [
        { name: 'M-Pesa Integration', description: 'Integrate Safaricom M-Pesa for KES settlement.', status: 'paused' },
      ],
      deployments: [
        { environment: 'sandbox', status: 'stopped', health: 'down' },
      ],
      brandColor: '#ef4444',
    },
  ];

  for (const seed of seeds) {
    const tenantId = ids.tenant();
    const planDef = seed.plan;
    const limits = getSeedLimits(planDef);

    // Members
    const members = [
      {
        id: ids.member(),
        tenantId,
        userId: seed.ownerId,
        role: 'owner' as const,
        invitedAt: now - 90 * day,
        joinedAt: now - 90 * day,
      },
      ...(seed.extraMembers ?? []).map((m, i) => ({
        id: ids.member(),
        tenantId,
        userId: m.userId,
        role: m.role,
        invitedAt: now - (60 - i * 5) * day,
        joinedAt: now - (58 - i * 5) * day,
        invitedBy: seed.ownerId,
      })),
    ];

    const tenant: CloudTenant = {
      id: tenantId,
      name: seed.name,
      slug: seed.slug,
      type: seed.type,
      plan: seed.plan,
      region: seed.region,
      status: seed.status ?? 'active',
      ownerId: seed.ownerId,
      createdAt: now - 90 * day,
      members,
      config: {
        features: getSeedFeatures(seed.plan),
        limits,
        branding: {
          primaryColor: seed.brandColor,
        },
        complianceRegion: seed.complianceRegion,
      },
      usage: {
        merchants: seed.usage?.merchants ?? 0,
        lps: seed.usage?.lps ?? 0,
        transactionsThisMonth: seed.usage?.transactionsThisMonth ?? 0,
        apiRequestsThisMinute: seed.usage?.apiRequestsThisMinute ?? 0,
        storageUsedGB: seed.usage?.storageUsedGB ?? 0,
        extensionsInstalled: seed.usage?.extensionsInstalled ?? 0,
        lastResetAt: now - 12 * day,
      },
      suspendedAt: seed.status === 'suspended' ? now - 2 * day : undefined,
      suspendedReason: seed.status === 'suspended' ? 'Compliance review pending — KYC documents overdue' : undefined,
    };

    store.tenants.set(tenantId, tenant);
    store.slugIndex.set(tenant.slug, tenantId);
    for (const m of members) {
      const set = store.userTenants.get(m.userId) ?? new Set<string>();
      set.add(tenantId);
      store.userTenants.set(m.userId, set);
    }

    // Programs
    for (const p of seed.programs ?? []) {
      const programId = ids.program();
      const program: CloudProgram = {
        id: programId,
        tenantId,
        name: p.name,
        description: p.description,
        status: p.status,
        config: {},
        createdAt: now - 60 * day,
        updatedAt: now - Math.floor(Math.random() * 5) * day,
        createdBy: seed.ownerId,
        pausedAt: p.status === 'paused' ? now - 3 * day : undefined,
      };
      store.programs.set(programId, program);
    }

    // Deployments
    for (const d of seed.deployments ?? []) {
      const deploymentId = ids.deployment();
      const deployment: CloudDeployment = {
        id: deploymentId,
        tenantId,
        environment: d.environment,
        region: seed.region,
        status: d.status ?? 'running',
        version: '1.0.0-cloud',
        url: `https://${tenant.slug}-${d.environment}.payswap.cloud`,
        deployedAt: now - Math.floor(Math.random() * 30) * day,
        health: d.health ?? 'healthy',
        logs: makeSeedLogs(d.environment, d.health ?? 'healthy'),
        config: {
          replicas: d.environment === 'production' ? 3 : 1,
          cpuMillicores: d.environment === 'production' ? 2000 : 500,
          memoryMB: d.environment === 'production' ? 4096 : 1024,
          storageGB: d.environment === 'production' ? 100 : 10,
        },
      };
      store.deployments.set(deploymentId, deployment);
    }

    // Subscription (one active per tenant)
    const subId = ids.subscription();
    const planAmount = getSeedPlanAmount(seed.plan);
    const subscription: CloudSubscription = {
      id: subId,
      tenantId,
      plan: seed.plan,
      status: seed.status === 'suspended' ? 'past_due' : 'active',
      currentPeriodStart: now - 18 * day,
      currentPeriodEnd: now + 12 * day,
      amount: planAmount,
      currency: 'USD',
      usageBasedCharges: [],
      createdAt: now - 90 * day,
    };
    store.subscriptions.set(tenantId, subscription);

    // Audit seed entries
    pushAudit({
      id: ids.audit(),
      tenantId,
      actorId: seed.ownerId,
      action: 'tenant.created',
      resourceId: tenantId,
      resourceType: 'tenant',
      details: { name: seed.name, plan: seed.plan, type: seed.type },
      timestamp: tenant.createdAt,
    });
    if (seed.status === 'suspended') {
      pushAudit({
        id: ids.audit(),
        tenantId,
        actorId: 'system',
        action: 'tenant.suspended',
        resourceId: tenantId,
        resourceType: 'tenant',
        details: { reason: tenant.suspendedReason },
        timestamp: tenant.suspendedAt!,
      });
    }
  }
}

function pushAudit(entry: CloudAuditEntry): void {
  store.audit.set(entry.id, entry);
}

// ─── Seed helpers ───────────────────────────────────────────────────────────

function getSeedLimits(plan: CloudTenant['plan']): CloudTenant['config']['limits'] {
  switch (plan) {
    case 'free':
      return { maxMerchants: 1, maxLPs: 1, maxTransactionsPerMonth: 1000, maxAPIRequestsPerMinute: 60, maxStorageGB: 1, maxExtensions: 3 };
    case 'starter':
      return { maxMerchants: 10, maxLPs: 5, maxTransactionsPerMonth: 25_000, maxAPIRequestsPerMinute: 300, maxStorageGB: 25, maxExtensions: 10 };
    case 'growth':
      return { maxMerchants: 100, maxLPs: 25, maxTransactionsPerMonth: 250_000, maxAPIRequestsPerMinute: 1500, maxStorageGB: 250, maxExtensions: 50 };
    case 'scale':
      return { maxMerchants: 1000, maxLPs: 100, maxTransactionsPerMonth: 2_500_000, maxAPIRequestsPerMinute: 10_000, maxStorageGB: 2500, maxExtensions: 250 };
    case 'enterprise':
      return { maxMerchants: 100_000, maxLPs: 1000, maxTransactionsPerMonth: 100_000_000, maxAPIRequestsPerMinute: 100_000, maxStorageGB: 50_000, maxExtensions: 10_000 };
  }
}

function getSeedFeatures(plan: CloudTenant['plan']): string[] {
  switch (plan) {
    case 'free':
      return ['payments', 'payouts', 'sandbox'];
    case 'starter':
      return ['payments', 'payouts', 'lp', 'treasury', 'extensions', 'sandbox', 'support_standard'];
    case 'growth':
      return ['payments', 'payouts', 'lp', 'treasury', 'extensions', 'sandbox', 'staging', 'production', 'support_priority', 'compliance_aml', 'compliance_kyc'];
    case 'scale':
      return ['payments', 'payouts', 'lp', 'treasury', 'extensions', 'sandbox', 'staging', 'production', 'support_dedicated', 'compliance_aml', 'compliance_kyc', 'compliance_travel_rule', 'multi_region', 'custom_domain'];
    case 'enterprise':
      return ['payments', 'payouts', 'lp', 'treasury', 'extensions', 'sandbox', 'staging', 'production', 'support_dedicated', 'compliance_aml', 'compliance_kyc', 'compliance_travel_rule', 'multi_region', 'custom_domain', 'sovereign_cloud', 'air_gap', 'custom_compliance'];
  }
}

function getSeedPlanAmount(plan: CloudTenant['plan']): number {
  switch (plan) {
    case 'free': return 0;
    case 'starter': return 99;
    case 'growth': return 499;
    case 'scale': return 1999;
    case 'enterprise': return 9_999;
  }
}

function makeSeedLogs(
  env: CloudDeployment['environment'],
  health: CloudDeployment['health'],
): CloudDeployment['logs'] {
  const now = Date.now();
  const logs: CloudDeployment['logs'] = [
    { timestamp: now - 1000 * 60 * 2, level: 'info', message: `kernel boot complete (env=${env})` },
    { timestamp: now - 1000 * 60 * 5, level: 'info', message: 'dispatcher subscribed to 290 event types' },
    { timestamp: now - 1000 * 60 * 9, level: 'info', message: 'ledger engine replayed last checkpoint' },
    { timestamp: now - 1000 * 60 * 15, level: 'info', message: 'council engine quorum healthy (5/5)' },
  ];
  if (health === 'degraded') {
    logs.push({ timestamp: now - 1000 * 60 * 3, level: 'warn', message: 'treasury-gh connector latency p95=1450ms (above 1000ms threshold)' });
    logs.push({ timestamp: now - 1000 * 60 * 1, level: 'warn', message: 'settlement queue depth 47 (back-pressure)' });
  }
  if (health === 'down') {
    logs.push({ timestamp: now - 1000 * 60 * 4, level: 'error', message: 'liveness probe failed (3/3)' });
    logs.push({ timestamp: now - 1000 * 60 * 3, level: 'error', message: 'deployment marked down — automated restart initiated' });
  }
  return logs;
}

// Auto-seed on first import.
seedCloudStore();
