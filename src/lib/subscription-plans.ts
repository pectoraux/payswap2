/**
 * Subscription plan definitions shared by the billing API and the billing
 * settings page. Keeping these in one place guarantees the limits shown in the
 * UI match the limits enforced by the backend.
 */

export type PlanId = 'starter' | 'growth' | 'scale' | 'enterprise';

export interface PlanLimits {
  /** Platform fee applied to each processed transaction, in percent. */
  feePercent: number;
  /** Max transactions per month. `null` means unlimited. */
  transactionsPerMonth: number | null;
  /** Max active API keys. `null` means unlimited. */
  apiKeys: number | null;
  /** Max active webhook endpoints. `null` means unlimited. */
  webhooks: number | null;
  /** Whether advanced analytics are included. */
  advancedAnalytics: boolean;
  /** Whether custom reports are included. */
  customReports: boolean;
  /** Whether dedicated support is included. */
  dedicatedSupport: boolean;
  /** Whether a contractual SLA is included. */
  sla: boolean;
  /** Whether custom integrations are available. */
  customIntegrations: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Display price, e.g. "Free", "$49/mo", "Custom". */
  priceLabel: string;
  /** Short marketing tagline. */
  tagline: string;
  /** Marketing feature bullets shown on the pricing card. */
  features: string[];
  limits: PlanLimits;
}

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceLabel: 'Free',
    tagline: 'Everything you need to test the waters.',
    features: [
      '2% transaction fee',
      '100 transactions / month',
      '1 API key',
      '1 webhook endpoint',
      'Basic analytics',
    ],
    limits: {
      feePercent: 2,
      transactionsPerMonth: 100,
      apiKeys: 1,
      webhooks: 1,
      advancedAnalytics: false,
      customReports: false,
      dedicatedSupport: false,
      sla: false,
      customIntegrations: false,
    },
  },
  {
    id: 'growth',
    name: 'Growth',
    priceLabel: '$49/mo',
    tagline: 'For growing businesses processing regularly.',
    features: [
      '1.5% transaction fee',
      '5,000 transactions / month',
      '5 API keys',
      '5 webhook endpoints',
      'Advanced analytics',
    ],
    limits: {
      feePercent: 1.5,
      transactionsPerMonth: 5000,
      apiKeys: 5,
      webhooks: 5,
      advancedAnalytics: true,
      customReports: false,
      dedicatedSupport: false,
      sla: false,
      customIntegrations: false,
    },
  },
  {
    id: 'scale',
    name: 'Scale',
    priceLabel: '$199/mo',
    tagline: 'For high-volume merchants that need headroom.',
    features: [
      '1% transaction fee',
      '50,000 transactions / month',
      'Unlimited API keys',
      'Unlimited webhooks',
      'Custom reports',
    ],
    limits: {
      feePercent: 1,
      transactionsPerMonth: 50000,
      apiKeys: null,
      webhooks: null,
      advancedAnalytics: true,
      customReports: true,
      dedicatedSupport: false,
      sla: false,
      customIntegrations: false,
    },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    priceLabel: 'Custom',
    tagline: 'Tailored terms for institutions and platforms.',
    features: [
      '0.5% transaction fee',
      'Unlimited transactions',
      'Dedicated support',
      'Contractual SLA',
      'Custom integrations',
    ],
    limits: {
      feePercent: 0.5,
      transactionsPerMonth: null,
      apiKeys: null,
      webhooks: null,
      advancedAnalytics: true,
      customReports: true,
      dedicatedSupport: true,
      sla: true,
      customIntegrations: true,
    },
  },
];

export const PLAN_IDS: PlanId[] = PLANS.map((p) => p.id);

export const PLAN_BY_ID: Record<PlanId, Plan> = PLANS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<PlanId, Plan>,
);

export const DEFAULT_PLAN: PlanId = 'starter';

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && PLAN_IDS.includes(value as PlanId);
}

export function getPlan(id: string | undefined | null): Plan {
  if (id && isPlanId(id)) return PLAN_BY_ID[id];
  return PLAN_BY_ID[DEFAULT_PLAN];
}
