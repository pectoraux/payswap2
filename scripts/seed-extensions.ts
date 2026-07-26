import { db } from '../src/lib/db';

/**
 * Seed the PaySwap extension marketplace with six published extensions,
 * realistic permissions, changelogs, install counts, ratings and reviews.
 *
 * Run with:  bun run scripts/seed-extensions.ts
 *
 * Idempotent: existing extensions (matched by slug) are upserted, and their
 * install counts / reviews are reset to the seed values.
 */

interface SeedDef {
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  pricing: 'free' | 'paid' | 'freemium';
  price: number;
  iconUrl: string | null;
  permissions: string[];
  config: Record<string, unknown> | null;
  changelog: Array<{ version: string; date: string; changes: string }>;
  installCount: number;
  rating: number;
  reviews: Array<{ rating: number; comment: string }>;
}

const DEVELOPER_EMAIL = 'developer@payswap.demo';

const SEEDS: SeedDef[] = [
  {
    slug: 'quickbooks-sync',
    name: 'QuickBooks Sync',
    description:
      'Automatically sync your PaySwap transactions, invoices and payouts to your QuickBooks Online ledger. Reconcile in one click and never miss a sale again.',
    category: 'accounting',
    version: '2.4.1',
    pricing: 'free',
    price: 0,
    iconUrl: null,
    permissions: ['read_payments', 'read_customers', 'send_webhooks'],
    config: {
      type: 'object',
      properties: {
        realmId: { type: 'string', title: 'QuickBooks Company ID' },
        clientId: { type: 'string', title: 'OAuth Client ID' },
        syncFrequency: {
          type: 'string',
          title: 'Sync frequency',
          enum: ['hourly', 'daily', 'weekly'],
          default: 'daily',
        },
        defaultIncomeAccount: {
          type: 'string',
          title: 'Default income account',
          default: 'Sales of Product Income',
        },
      },
      required: ['realmId', 'clientId'],
    },
    changelog: [
      {
        version: '2.4.1',
        date: '2025-06-18T10:00:00.000Z',
        changes:
          'Fix duplicate invoice numbers when syncing high-volume merchants.',
      },
      {
        version: '2.4.0',
        date: '2025-05-02T10:00:00.000Z',
        changes: 'Add support for multi-currency payouts and FX gain/loss entries.',
      },
      {
        version: '2.3.0',
        date: '2025-03-11T10:00:00.000Z',
        changes: 'Initial PaySwap v2 marketplace release.',
      },
    ],
    installCount: 1284,
    rating: 4.6,
    reviews: [
      { rating: 5, comment: 'Sync just works. Saved our accountant a full day every month.' },
      { rating: 4, comment: 'Solid integration — would love support for QuickBooks Desktop too.' },
      { rating: 5, comment: 'Setup took 5 minutes. Auto-reconciliation is a game changer.' },
    ],
  },
  {
    slug: 'mailchimp-integration',
    name: 'Mailchimp Integration',
    description:
      'Add paying customers to Mailchimp audiences automatically and trigger email journeys on payment events. Grow repeat business with segmented campaigns.',
    category: 'marketing',
    version: '1.8.0',
    pricing: 'free',
    price: 0,
    iconUrl: null,
    permissions: ['read_customers', 'read_payments', 'send_webhooks'],
    config: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', title: 'Mailchimp API Key' },
        serverPrefix: { type: 'string', title: 'Server prefix (e.g. us19)' },
        audienceId: { type: 'string', title: 'Default Audience ID' },
        tagOnPurchase: { type: 'string', title: 'Tag to apply on purchase', default: 'customer' },
      },
      required: ['apiKey', 'serverPrefix', 'audienceId'],
    },
    changelog: [
      {
        version: '1.8.0',
        date: '2025-06-30T10:00:00.000Z',
        changes: 'Add segmentation tags based on lifetime spend tiers.',
      },
      {
        version: '1.7.0',
        date: '2025-04-12T10:00:00.000Z',
        changes: 'OAuth refresh-token flow for improved security.',
      },
    ],
    installCount: 932,
    rating: 4.3,
    reviews: [
      { rating: 4, comment: 'Great for re-engagement flows after a customer pays.' },
      { rating: 5, comment: 'Easy setup and the tagging is exactly what we needed.' },
    ],
  },
  {
    slug: 'slack-notifications',
    name: 'Slack Notifications',
    description:
      'Get instant Slack alerts for new payments, refunds, failed payouts and large transactions. Route notifications to the right channels with smart filters.',
    category: 'other',
    version: '1.2.4',
    pricing: 'free',
    price: 0,
    iconUrl: null,
    permissions: ['read_payments', 'send_webhooks'],
    config: {
      type: 'object',
      properties: {
        webhookUrl: { type: 'string', title: 'Slack Incoming Webhook URL' },
        channel: { type: 'string', title: 'Default channel', default: '#payments' },
        minAlertAmount: {
          type: 'number',
          title: 'Minimum amount to alert (USD)',
          default: 0,
        },
        events: {
          type: 'string',
          title: 'Events to forward',
          default: 'payment.completed,payout.failed,refund.created',
        },
      },
      required: ['webhookUrl'],
    },
    changelog: [
      {
        version: '1.2.4',
        date: '2025-07-10T10:00:00.000Z',
        changes: 'Throttle duplicate alerts during connector outages.',
      },
      {
        version: '1.2.0',
        date: '2025-05-22T10:00:00.000Z',
        changes: 'Add min-amount filter and per-event routing.',
      },
    ],
    installCount: 1748,
    rating: 4.8,
    reviews: [
      { rating: 5, comment: 'We catch failed payouts instantly now. Indispensable.' },
      { rating: 5, comment: 'Setup in two minutes. Filter rules just work.' },
      { rating: 4, comment: 'Wish it supported Microsoft Teams too.' },
    ],
  },
  {
    slug: 'advanced-analytics',
    name: 'Advanced Analytics',
    description:
      'Unlock cohort retention, LTV/CAC, corridor profitability and merchant health scoring with dashboards built on top of your live PaySwap data.',
    category: 'analytics',
    version: '3.1.0',
    pricing: 'paid',
    price: 29,
    iconUrl: null,
    permissions: ['read_payments', 'read_customers', 'send_webhooks'],
    config: {
      type: 'object',
      properties: {
        timezone: { type: 'string', title: 'Reporting timezone', default: 'Africa/Accra' },
        currency: { type: 'string', title: 'Display currency', default: 'USD' },
        weeklyDigest: { type: 'string', title: 'Weekly digest email', enum: ['enabled', 'disabled'], default: 'enabled' },
      },
      required: ['timezone'],
    },
    changelog: [
      {
        version: '3.1.0',
        date: '2025-07-01T10:00:00.000Z',
        changes: 'New corridor profitability dashboard with FX-aware margins.',
      },
      {
        version: '3.0.0',
        date: '2025-04-29T10:00:00.000Z',
        changes: 'Cohort retention + LTV/CAC models. Faster query engine.',
      },
    ],
    installCount: 412,
    rating: 4.5,
    reviews: [
      { rating: 5, comment: 'The cohort view finally made our retention legible.' },
      { rating: 4, comment: 'Worth the $29 — would love CSV export of dashboards.' },
    ],
  },
  {
    slug: 'fraud-detection-pro',
    name: 'Fraud Detection Pro',
    description:
      'ML-powered fraud scoring on every transaction. Velocity checks, device fingerprinting, and rule-based blocking with explainable risk reasons.',
    category: 'compliance',
    version: '2.0.3',
    pricing: 'paid',
    price: 99,
    iconUrl: null,
    permissions: ['read_payments', 'write_payments', 'read_customers', 'send_webhooks'],
    config: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', title: 'Fraud API Key' },
        blockThreshold: {
          type: 'number',
          title: 'Auto-block risk score threshold (0-100)',
          default: 85,
        },
        reviewThreshold: {
          type: 'number',
          title: 'Manual-review risk score threshold (0-100)',
          default: 60,
        },
        webhookOnBlock: {
          type: 'string',
          title: 'Webhook on block',
          enum: ['enabled', 'disabled'],
          default: 'enabled',
        },
      },
      required: ['apiKey'],
    },
    changelog: [
      {
        version: '2.0.3',
        date: '2025-06-25T10:00:00.000Z',
        changes: 'New velocity rule builder with per-corridor limits.',
      },
      {
        version: '2.0.0',
        date: '2025-03-30T10:00:00.000Z',
        changes: 'Explainable ML model with per-feature contribution breakdown.',
      },
    ],
    installCount: 287,
    rating: 4.7,
    reviews: [
      { rating: 5, comment: 'Caught a card-testing attack within an hour of going live.' },
      { rating: 5, comment: 'Explainable scores made our compliance team happy.' },
      { rating: 4, comment: 'Pricey but the false-positive rate is impressively low.' },
    ],
  },
  {
    slug: 'shopify-sync',
    name: 'Shopify Sync',
    description:
      'Accept PaySwap at Shopify checkout with automatic order fulfillment, refund reconciliation and customer sync. Free for under 100 orders/mo.',
    category: 'crm',
    version: '1.5.2',
    pricing: 'freemium',
    price: 19,
    iconUrl: null,
    permissions: ['read_payments', 'write_payments', 'read_customers', 'send_webhooks'],
    config: {
      type: 'object',
      properties: {
        shopDomain: { type: 'string', title: 'Shopify shop domain (e.g. mystore.myshopify.com)' },
        accessToken: { type: 'string', title: 'Shopify Admin API access token' },
        syncCustomers: {
          type: 'string',
          title: 'Sync customers',
          enum: ['enabled', 'disabled'],
          default: 'enabled',
        },
        autoFulfill: {
          type: 'string',
          title: 'Auto-fulfill on payment',
          enum: ['enabled', 'disabled'],
          default: 'disabled',
        },
      },
      required: ['shopDomain', 'accessToken'],
    },
    changelog: [
      {
        version: '1.5.2',
        date: '2025-07-08T10:00:00.000Z',
        changes: 'Handle Shopify multi-location inventory allocations.',
      },
      {
        version: '1.5.0',
        date: '2025-05-15T10:00:00.000Z',
        changes: 'Add refund reconciliation and dispute webhook forwarding.',
      },
    ],
    installCount: 658,
    rating: 4.4,
    reviews: [
      { rating: 4, comment: 'Setup was straightforward and the free tier covers our volume.' },
      { rating: 5, comment: 'Refund reconciliation alone saved us hours of bookkeeping.' },
      { rating: 4, comment: 'Works well — would love bulk product import next.' },
    ],
  },
];

/**
 * Look up a couple of merchant IDs we can use to create realistic
 * ExtensionInstall rows for some of the seeded extensions.
 */
async function pickSampleMerchants(): Promise<string[]> {
  const merchants = await db.merchant.findMany({
    where: { status: 'ACTIVE' },
    take: 8,
    select: { id: true },
  });
  return merchants.map((m) => m.id);
}

async function upsertExtension(seed: SeedDef, developerId: string) {
  const data = {
    name: seed.name,
    description: seed.description,
    developerId,
    category: seed.category,
    iconUrl: seed.iconUrl,
    version: seed.version,
    status: 'published' as const,
    permissions: JSON.stringify(seed.permissions),
    pricing: seed.pricing,
    price: seed.price,
    config: seed.config ? JSON.stringify(seed.config) : null,
    changelog: JSON.stringify(seed.changelog),
    installCount: seed.installCount,
    rating: 0, // recomputed below from reviews
    reviewCount: 0,
    submittedAt: new Date('2025-01-15T10:00:00.000Z'),
    reviewedAt: new Date('2025-01-18T10:00:00.000Z'),
    reviewedBy: developerId,
    reviewNotes: null,
    publishedAt: new Date('2025-01-19T10:00:00.000Z'),
  };

  const existing = await db.extension.findUnique({ where: { slug: seed.slug } });
  let extension;
  if (existing) {
    extension = await db.extension.update({
      where: { id: existing.id },
      data: data as any,
    });
    // Wipe old reviews + installs so re-seeds are deterministic.
    await db.extensionReview.deleteMany({ where: { extensionId: extension.id } });
    await db.extensionInstall.deleteMany({ where: { extensionId: extension.id } });
  } else {
    extension = await db.extension.create({
      data: { slug: seed.slug, ...(data as any) },
    });
  }
  return extension;
}

async function createReviews(
  extensionId: string,
  reviews: Array<{ rating: number; comment: string }>,
  reviewerId: string,
) {
  if (reviews.length === 0) return;
  // Compute the new aggregate rating.
  const sum = reviews.reduce((s, r) => s + r.rating, 0);
  const avg = Math.round((sum / reviews.length) * 10) / 10;

  for (const r of reviews) {
    await db.extensionReview.create({
      data: {
        extensionId,
        userId: reviewerId,
        rating: r.rating,
        comment: r.comment,
      },
    });
  }

  await db.extension.update({
    where: { id: extensionId },
    data: {
      rating: avg,
      reviewCount: reviews.length,
    },
  });
}

async function createInstalls(
  extensionId: string,
  merchantIds: string[],
  count: number,
  config: Record<string, unknown> | null,
) {
  if (merchantIds.length === 0 || count === 0) return;
  // Create at most `count` (or merchantIds.length) installs.
  const toCreate = Math.min(count, merchantIds.length);
  for (let i = 0; i < toCreate; i++) {
    await db.extensionInstall.create({
      data: {
        extensionId,
        merchantId: merchantIds[i],
        status: 'active',
        config: config ? JSON.stringify(config) : null,
        installedAt: new Date(Date.now() - i * 86_400_000),
      },
    }).catch(() => {
      // Ignore unique-constraint collisions from prior runs.
    });
  }
}

async function main() {
  console.log('Seeding extensions…');

  const developer = await db.user.findUnique({
    where: { email: DEVELOPER_EMAIL },
    select: { id: true, email: true },
  });
  if (!developer) {
    throw new Error(
      `Developer user not found: ${DEVELOPER_EMAIL}. Run the base seed first.`,
    );
  }
  console.log(`Developer: ${developer.email}`);

  const merchantIds = await pickSampleMerchants();
  console.log(`Found ${merchantIds.length} merchants for sample installs.`);

  for (const seed of SEEDS) {
    const ext = await upsertExtension(seed, developer.id);
    console.log(`  • ${seed.slug} (${seed.category}, ${seed.pricing})`);

    // Re-create reviews against the merchant user (if available) — fallback
    // to the developer user id.
    const reviewerId = merchantIds.length > 0 ? developer.id : developer.id;
    await createReviews(ext.id, seed.reviews, reviewerId);

    // Seed a handful of installs to make the marketplace feel alive.
    await createInstalls(
      ext.id,
      merchantIds,
      Math.min(3, seed.installCount),
      seed.config,
    );
  }

  console.log(`\nDone! Seeded ${SEEDS.length} published extensions.`);
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    db.$disconnect();
    process.exit(1);
  });
