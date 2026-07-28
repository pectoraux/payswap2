/**
 * Shared lifecycle + permission vocabulary for the Extension Marketplace.
 *
 * The Prisma schema stores these as plain strings (no enum constraint), so
 * this module is the single source of truth for the canonical names.
 *
 * Lifecycle (M-PLATFORM-38 PART 3):
 *   draft → sandbox → submitted → static_analysis → security_scan → review
 *         → approved → published → deprecated → archived
 *   (rejected at any review stage; suspended after published)
 *
 * Install states (per merchant):
 *   enabled | disabled | suspended | pending
 */

export const EXTENSION_STATUSES = [
  'draft',
  'sandbox',
  'submitted',
  'static_analysis',
  'security_scan',
  'review',
  'approved',
  'published',
  'rejected',
  'suspended',
  'deprecated',
  'archived',
] as const;
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];

export const INSTALL_STATUSES = [
  'enabled',
  'disabled',
  'suspended',
  'pending',
  'archived',
] as const;
export type InstallStatus = (typeof INSTALL_STATUSES)[number];

/**
 * Backwards-compat: the seed script and older API routes used `active` for
 * installs. We normalize to `enabled` everywhere.
 */
export function normalizeInstallStatus(raw: string | null | undefined): InstallStatus {
  if (!raw) return 'enabled';
  const r = raw.toLowerCase();
  if (r === 'active') return 'enabled';
  if (INSTALL_STATUSES.includes(r as InstallStatus)) return r as InstallStatus;
  return 'enabled';
}

/**
 * Permissions model (M-PLATFORM-38 PART 3):
 *   Payments, Wallets, Transactions, Customer Data, Analytics, Treasury,
 *   Marketplace, Notifications, Reports.
 *
 * We keep the underscore-keyed form for storage and add a human-readable
 * label + description for the consent dialog.
 */
export interface PermissionSpec {
  key: string;
  label: string;
  description: string;
}

export const PERMISSION_SPECS: PermissionSpec[] = [
  {
    key: 'read_payments',
    label: 'Read payments',
    description: 'View your payment history, amounts and statuses.',
  },
  {
    key: 'write_payments',
    label: 'Create & refund payments',
    description: 'Issue refunds, capture authorizations, and create payments on your behalf.',
  },
  {
    key: 'read_customers',
    label: 'Read customer data',
    description: 'Access customer profiles, contact details, and lifetime value.',
  },
  {
    key: 'write_customers',
    label: 'Modify customer data',
    description: 'Create, update, and delete customer records in your account.',
  },
  {
    key: 'read_transactions',
    label: 'Read transactions',
    description: 'View ledger entries, treasury flows and settlement legs.',
  },
  {
    key: 'read_wallets',
    label: 'Read wallets',
    description: 'Inspect wallet balances and reserve positions.',
  },
  {
    key: 'write_wallets',
    label: 'Move wallet funds',
    description: 'Initiate transfers between wallets and treasury accounts.',
  },
  {
    key: 'read_analytics',
    label: 'Read analytics',
    description: 'Access aggregated metrics, cohorts and corridor profitability.',
  },
  {
    key: 'read_treasury',
    label: 'Read treasury',
    description: 'View treasury positions, FX exposure and liquidity pools.',
  },
  {
    key: 'send_webhooks',
    label: 'Send notifications',
    description: 'Deliver event webhooks to the extension\u2019s configured endpoints.',
  },
  {
    key: 'manage_marketplace',
    label: 'Manage marketplace',
    description: 'Install, configure, and uninstall other extensions on your behalf.',
  },
  {
    key: 'read_reports',
    label: 'Read reports',
    description: 'Access scheduled financial and compliance reports.',
  },
];

export const PERMISSION_KEYS = PERMISSION_SPECS.map((p) => p.key);

export function permissionLabel(key: string): string {
  return PERMISSION_SPECS.find((p) => p.key === key)?.label ?? key.replace(/_/g, ' ');
}

export function permissionDescription(key: string): string {
  return (
    PERMISSION_SPECS.find((p) => p.key === key)?.description ??
    'This extension will gain access to this scope.'
  );
}

/**
 * Categories (M-PLATFORM-38 PART 3):
 *   Accounting, Analytics, CRM, Marketing, Inventory, Loyalty, Payroll, Tax,
 *   Savings, ERP, Insurance, AI, plus meta-filters Featured / Popular /
 *   Installed.
 */
export interface CategorySpec {
  key: string;
  label: string;
  /** Tailwind classes for the category badge. */
  tone: string;
  /** Lucide icon name (resolved client-side via the icon map). */
  icon: string;
}

export const CATEGORY_SPECS: CategorySpec[] = [
  { key: 'accounting', label: 'Accounting', tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400', icon: 'Calculator' },
  { key: 'analytics', label: 'Analytics', tone: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400', icon: 'BarChart3' },
  { key: 'crm', label: 'CRM', tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400', icon: 'Users' },
  { key: 'marketing', label: 'Marketing', tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', icon: 'Megaphone' },
  { key: 'inventory', label: 'Inventory', tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', icon: 'Boxes' },
  { key: 'loyalty', label: 'Loyalty', tone: 'bg-pink-500/10 text-pink-600 dark:text-pink-400', icon: 'Heart' },
  { key: 'payroll', label: 'Payroll', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', icon: 'Banknote' },
  { key: 'tax', label: 'Tax', tone: 'bg-orange-500/10 text-orange-600 dark:text-orange-400', icon: 'ReceiptText' },
  { key: 'savings', label: 'Savings', tone: 'bg-lime-500/10 text-lime-600 dark:text-lime-400', icon: 'PiggyBank' },
  { key: 'erp', label: 'ERP', tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400', icon: 'Network' },
  { key: 'insurance', label: 'Insurance', tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400', icon: 'ShieldCheck' },
  { key: 'ai', label: 'AI', tone: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400', icon: 'Sparkles' },
  // Legacy categories from the seed data — still allowed so seeded extensions
  // are not orphaned.
  { key: 'payments', label: 'Payments', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', icon: 'CreditCard' },
  { key: 'compliance', label: 'Compliance', tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', icon: 'ShieldAlert' },
  { key: 'shipping', label: 'Shipping', tone: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', icon: 'Truck' },
  { key: 'other', label: 'Other', tone: 'bg-muted text-muted-foreground', icon: 'Puzzle' },
];

export const CATEGORY_KEYS = CATEGORY_SPECS.map((c) => c.key);

export function categorySpec(key: string): CategorySpec {
  return (
    CATEGORY_SPECS.find((c) => c.key === key) ?? {
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      tone: 'bg-muted text-muted-foreground',
      icon: 'Puzzle',
    }
  );
}

/**
 * Lifecycle timeline for the admin detail drawer. The order is the canonical
 * progression; `rejected`, `suspended`, `deprecated`, `archived` are
 * side-states that don't appear in the main flow.
 */
export const LIFECYCLE_FLOW: ExtensionStatus[] = [
  'draft',
  'sandbox',
  'submitted',
  'static_analysis',
  'security_scan',
  'review',
  'approved',
  'published',
];

export const STATUS_META: Record<
  string,
  { label: string; tone: string; description: string }
> = {
  draft: {
    label: 'Draft',
    tone: 'bg-muted text-muted-foreground',
    description: 'Created by the developer, not yet submitted.',
  },
  sandbox: {
    label: 'Sandbox',
    tone: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    description: 'Being tested in the sandbox environment.',
  },
  submitted: {
    label: 'Submitted',
    tone: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    description: 'Submitted for marketplace review.',
  },
  static_analysis: {
    label: 'Static analysis',
    tone: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    description: 'Running automated static code analysis.',
  },
  security_scan: {
    label: 'Security scan',
    tone: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
    description: 'Running automated security & dependency scan.',
  },
  review: {
    label: 'Under review',
    tone: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    description: 'Awaiting admin reviewer decision.',
  },
  approved: {
    label: 'Approved',
    tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    description: 'Approved and ready to publish.',
  },
  published: {
    label: 'Published',
    tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    description: 'Live on the marketplace, installable by merchants.',
  },
  rejected: {
    label: 'Rejected',
    tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    description: 'Rejected by an admin reviewer.',
  },
  suspended: {
    label: 'Suspended',
    tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    description: 'Temporarily removed from the marketplace.',
  },
  deprecated: {
    label: 'Deprecated',
    tone: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    description: 'No longer recommended; existing installs keep working.',
  },
  archived: {
    label: 'Archived',
    tone: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
    description: 'Permanently retired; no new installs allowed.',
  },
};

export const INSTALL_STATUS_META: Record<
  string,
  { label: string; tone: string }
> = {
  enabled: {
    label: 'Enabled',
    tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  disabled: {
    label: 'Disabled',
    tone: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  },
  suspended: {
    label: 'Suspended',
    tone: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  pending: {
    label: 'Pending',
    tone: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  },
  archived: {
    label: 'Archived',
    tone: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  },
  // Backwards-compat with seed data (`active`).
  active: {
    label: 'Enabled',
    tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
};

/**
 * Best-effort JSON parse. Returns null when the input is null / malformed.
 */
export function safeJson<T = unknown>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
