/**
 * Public Ecosystem Marketplace — types.
 *
 * The Public Marketplace is where THIRD-PARTY developers publish plugins built
 * with the Capability SDK for anyone to install. This is distinct from the
 * internal "Extensions" marketplace (which uses the same Prisma `Extension`
 * table but with the legacy category vocabulary).
 *
 * Storage strategy (no schema migration):
 *   - Plugins are persisted as rows in the existing `Extension` table.
 *   - The `category` column stores the marketplace category key
 *     (e.g. "country", "settlement-rail", "wallet").
 *   - The `config` JSON column stores a `MarketplaceMeta` blob with the full
 *     plugin manifest, capabilities, pricing, screenshots, developer profile,
 *     verification results, etc.
 *   - The `permissions` column stores the SDK permission strings
 *     ("payments:read", "wallets:write", etc.).
 *   - Reviews reuse the existing `ExtensionReview` table.
 *   - Installs reuse the existing `ExtensionInstall` table.
 *
 * This module is the single source of truth for the marketplace shape.
 */

import type {
  PluginManifest,
  CapabilityDeclaration,
  Permission,
  CapabilityType,
} from '@/sdk/types';

/** Canonical marketplace categories (M-ECO-43 spec). */
export const MARKETPLACE_CATEGORIES = [
  'country',
  'settlement-rail',
  'identity-provider',
  'compliance-module',
  'wallet',
  'fraud-engine',
  'ai-director',
  'marketplace-algorithm',
  'analytics-pack',
] as const;
export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number];

export interface CategoryMeta {
  key: MarketplaceCategory;
  label: string;
  description: string;
  /** Tailwind classes for the category badge. */
  tone: string;
  /** Lucide icon name (resolved client-side via the icon map). */
  icon: string;
}

export const CATEGORY_META: CategoryMeta[] = [
  {
    key: 'country',
    label: 'Countries',
    description: 'Country packs — local currencies, regulations, banking rails and holidays.',
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    icon: 'Globe2',
  },
  {
    key: 'settlement-rail',
    label: 'Settlement Rails',
    description: 'Mobile money, bank transfer, card networks, stablecoin bridges and cash rails.',
    tone: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    icon: 'Route',
  },
  {
    key: 'identity-provider',
    label: 'Identity Providers',
    description: 'KYC, KYB, biometric, national-ID and wallet-attestation providers.',
    tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    icon: 'Fingerprint',
  },
  {
    key: 'compliance-module',
    label: 'Compliance Modules',
    description: 'Sanctions, AML, OFAC, GDPR, travel-rule and audit-trail modules.',
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    icon: 'ShieldCheck',
  },
  {
    key: 'wallet',
    label: 'Wallets',
    description: 'Custodial and non-custodial wallets, HD key management, MPC signing.',
    tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    icon: 'Wallet',
  },
  {
    key: 'fraud-engine',
    label: 'Fraud Engines',
    description: 'Rule-based and ML-based fraud scoring, velocity checks, device fingerprinting.',
    tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    icon: 'ShieldAlert',
  },
  {
    key: 'ai-director',
    label: 'AI Directors',
    description: 'Treasury optimizers, corridor predictors, anomaly detectors and risk AIs.',
    tone: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400',
    icon: 'Sparkles',
  },
  {
    key: 'marketplace-algorithm',
    label: 'Marketplace Algorithms',
    description: 'Best-price routers, lowest-latency routers and LP-selection algorithms.',
    tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    icon: 'Network',
  },
  {
    key: 'analytics-pack',
    label: 'Analytics Packs',
    description: 'Revenue, corridor, settlement and treasury analytics dashboards.',
    tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    icon: 'BarChart3',
  },
];

export function categoryMeta(key: string): CategoryMeta {
  return (
    CATEGORY_META.find((c) => c.key === key) ?? {
      key: key as MarketplaceCategory,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      description: '',
      tone: 'bg-muted text-muted-foreground',
      icon: 'Puzzle',
    }
  );
}

/** Pricing models supported by the public marketplace. */
export type PricingModel = 'free' | 'one-time' | 'subscription' | 'usage-based';

export interface PricingPlan {
  model: PricingModel;
  /** For one-time: price in USD. For subscription: monthly price in USD. */
  price?: number;
  /** For usage-based: price per 1000 calls in USD. */
  pricePerKCalls?: number;
  /** Free tier limits, e.g. "1,000 calls/mo". */
  freeTier?: string;
  /** Human-readable summary, e.g. "$29/mo" or "$0.10 / 1k calls". */
  summary: string;
}

/** A public review on a plugin. */
export interface PluginReview {
  id: string;
  pluginId: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

/** A developer profile surfaced on the marketplace. */
export interface DeveloperProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  bio: string;
  verified: boolean;
  /** Aggregate rating across all their plugins. */
  aggregateRating: number;
  totalInstalls: number;
  pluginCount: number;
  joinedAt: string;
}

/** Verification result for a plugin. */
export type VerificationStatus =
  | 'unverified'
  | 'pending'
  | 'passed'
  | 'failed'
  | 'warning';

export interface VerificationFinding {
  /** Stage that produced this finding. */
  stage: 'schema' | 'dependencies' | 'permissions' | 'security' | 'sandbox' | 'capabilities';
  severity: 'info' | 'warning' | 'error';
  message: string;
  /** Optional path to the offending field, e.g. "manifest.capabilities[0]". */
  path?: string;
}

export interface VerificationResult {
  status: VerificationStatus;
  findings: VerificationFinding[];
  /** Aggregate score 0-100 (100 = clean). */
  score: number;
  ranAt: string;
  durationMs: number;
}

/** A plugin screenshot. */
export interface PluginScreenshot {
  url: string;
  caption: string;
}

/** A version history entry. */
export interface PluginVersionEntry {
  version: string;
  date: string;
  changes: string;
}

/**
 * Marketplace metadata — stored as JSON in the Extension.config column.
 *
 * The `marketplace: true` flag distinguishes public marketplace plugins from
 * the legacy internal extensions.
 */
export interface MarketplaceMeta {
  marketplace: true;
  /** Long-form marketing description (markdown). */
  longDescription?: string;
  /** The Capability SDK manifest (capabilities, permissions, commands, etc.). */
  manifest?: PluginManifest;
  /** Capability declarations (also in manifest, but exposed for fast queries). */
  capabilities?: CapabilityDeclaration[];
  /** Permissions required (SDK permission strings). */
  permissions?: Permission[];
  /** Pricing plans. */
  pricing?: PricingPlan;
  /** Documentation URL. */
  documentationUrl?: string;
  /** Support URL or email. */
  supportUrl?: string;
  /** Privacy policy URL. */
  privacyUrl?: string;
  /** Terms of service URL. */
  termsUrl?: string;
  /** Screenshots. */
  screenshots?: PluginScreenshot[];
  /** Tags for search. */
  tags?: string[];
  /** Other plugin slugs this depends on. */
  dependencies?: Array<{ slug: string; minVersion?: string }>;
  /** Developer bio (overrides the user.name for the public profile). */
  developerBio?: string;
  /** Verification status of the plugin (cached). */
  verification?: VerificationResult;
  /** Featured flag (managed by admin). */
  featured?: boolean;
}

/** The public-facing plugin shape returned by the catalog + APIs. */
export interface PublicPlugin {
  id: string;
  slug: string;
  name: string;
  description: string;
  longDescription: string;
  category: MarketplaceCategory;
  iconUrl: string | null;
  version: string;
  developerId: string;
  developerName: string;
  developerVerified: boolean;
  status: string;
  capabilities: CapabilityDeclaration[];
  capabilityTypes: CapabilityType[];
  permissions: Permission[];
  pricing: PricingPlan;
  documentationUrl: string;
  screenshots: PluginScreenshot[];
  tags: string[];
  dependencies: Array<{ slug: string; minVersion?: string }>;
  changelog: PluginVersionEntry[];
  installCount: number;
  rating: number;
  reviewCount: number;
  featured: boolean;
  verification: VerificationResult | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Result of an install operation. */
export interface InstallResult {
  ok: boolean;
  installId?: string;
  pluginId: string;
  merchantId: string;
  status: string;
  error?: string;
}

/** Search filters. */
export interface SearchFilters {
  category?: MarketplaceCategory | 'all';
  pricing?: PricingModel | 'all';
  minRating?: number;
  capabilityType?: CapabilityType | 'all';
  free?: boolean;
}

/** Internal helper — converts an Extension DB row to a PublicPlugin. */
export interface ExtensionRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  developerId: string;
  category: string;
  iconUrl: string | null;
  version: string;
  status: string;
  permissions: string;
  pricing: string;
  price: number;
  config: string | null;
  changelog: string | null;
  installCount: number;
  rating: number;
  reviewCount: number;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parse a `MarketplaceMeta` from the Extension.config JSON column.
 * Returns an empty meta (with `marketplace: true`) when missing/invalid.
 */
export function parseMarketplaceMeta(raw: string | null): MarketplaceMeta {
  if (!raw) return { marketplace: true };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.marketplace === true) {
      return parsed as MarketplaceMeta;
    }
    return { marketplace: true };
  } catch {
    return { marketplace: true };
  }
}

/** Serialize a `MarketplaceMeta` to a JSON string for storage. */
export function serializeMarketplaceMeta(meta: MarketplaceMeta): string {
  return JSON.stringify(meta);
}

/** Parse a PluginVersionEntry[] from the Extension.changelog JSON column. */
export function parseChangelog(raw: string | null): PluginVersionEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as PluginVersionEntry[];
    return [];
  } catch {
    return [];
  }
}

/** Permission vocabulary for the SDK (re-exported for convenience). */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'payments:read': 'Read payments',
  'payments:write': 'Write payments',
  'payouts:read': 'Read payouts',
  'payouts:write': 'Write payouts',
  'wallets:read': 'Read wallets',
  'wallets:write': 'Write wallets',
  'customers:read': 'Read customers',
  'customers:write': 'Write customers',
  'ledger:read': 'Read ledger',
  'ledger:write': 'Write ledger',
  'treasury:read': 'Read treasury',
  'treasury:write': 'Write treasury',
  'marketplace:read': 'Read marketplace',
  'marketplace:write': 'Write marketplace',
  'compliance:read': 'Read compliance',
  'compliance:write': 'Write compliance',
  'runtime:read': 'Read runtime',
  'runtime:write': 'Write runtime',
  'events:read': 'Read events',
  'events:write': 'Write events',
};

/** Permissions flagged as "dangerous" by the security scanner. */
export const DANGEROUS_PERMISSIONS: Permission[] = [
  'payments:write',
  'payouts:write',
  'wallets:write',
  'ledger:write',
  'treasury:write',
  'compliance:write',
  'runtime:write',
];

/** Patterns the security scanner treats as suspicious. */
export const SUSPICIOUS_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /eval\s*\(/, reason: 'Use of eval() is forbidden in plugin code.' },
  { regex: /new\s+Function\s*\(/, reason: 'Dynamic Function constructor is forbidden.' },
  { regex: /require\s*\(/, reason: 'Direct require() is forbidden — use the PluginContext.' },
  { regex: /process\./, reason: 'Access to process.* is forbidden in plugins.' },
  { regex: /child_process/, reason: 'child_process is forbidden in plugins.' },
  { regex: /fs\./, reason: 'Direct fs access is forbidden — use ctx.store.' },
  { regex: /fetch\s*\(/, reason: 'fetch() requires the network permission.' },
  { regex: /XMLHttpRequest/, reason: 'XMLHttpRequest requires the network permission.' },
  { regex: /\.env\b/, reason: 'References to .env are suspicious in plugin code.' },
  { regex: /atob\s*\(/, reason: 'atob() can be used to hide payloads.' },
];
