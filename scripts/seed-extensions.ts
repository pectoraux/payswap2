/**
 * Seed the 5 reference extensions into the marketplace database.
 * This makes them visible in the /marketplace UI.
 */

import { db } from '../src/lib/db';

async function main() {
  // Find or create a developer user
  let dev = await db.user.findFirst({ where: { email: 'dev@payswap.dev' } });
  if (!dev) {
    dev = await db.user.create({
      data: {
        email: 'dev@payswap.dev',
        name: 'PaySwap Extensions',
        passwordHash: '$2a$10$placeholder',
        status: 'ACTIVE',
      },
    });
    await db.userRole.create({
      data: { userId: dev.id, role: 'DEVELOPER' },
    });
  }

  const extensions = [
    {
      slug: 'parcel-delivery',
      name: 'Parcel Delivery',
      description: 'Complete logistics marketplace extension. Create delivery requests after purchases, optimize routes, auction courier bundles, track deliveries, and manage proof of delivery. Integrates with Uber, Bolt, Glovo, FedEx, DHL, UPS. Uses resolve() for AI route planning and exact Money for pricing.',
      category: 'shipping',
      version: '1.0.0',
      permissions: JSON.stringify(['read_payments', 'read_customers', 'write_orders']),
      pricing: 'freemium',
      price: 0.50,
      config: JSON.stringify({
        marketplace: true,
        capabilities: ['Create Delivery', 'Cancel Delivery', 'Schedule Delivery', 'Group Deliveries', 'Route Optimization', 'Courier Auction', 'Delivery Tracking', 'Delivery Insurance', 'Signature Verification', 'Parcel Pickup', 'Proof of Delivery', 'Transit Optimization'],
        featured: true,
        longDescription: 'The flagship first-party extension. Exercises every platform subsystem: SDK, capability graph, EKG, resolve(), Money, event sourcing, provider adapters, billing, OAuth, health monitoring. Includes VRP route solver, distributed auction engine, and chaos-tested resilience.',
        manifest: { id: 'parcel-delivery', version: '1.0.0', category: 'LOGISTICS', billing: { model: 'USAGE_BASED', usagePrice: 0.50 } },
        tags: ['delivery', 'logistics', 'shipping', 'courier', 'tracking', 'auction', 'routing', 'carbon'],
        screenshots: [],
        pricing: { plan: 'USAGE_BASED', price: 0.50, metric: 'per_delivery', trialDays: 30 },
      }),
      status: 'published',
      publishedAt: new Date(),
    },
    {
      slug: 'inventory-management',
      name: 'Inventory Management',
      description: 'Warehouse management with stock reservations, transfers, purchase orders, and inventory events. Automatically reserves stock when sales complete. Validates database migrations, transactions, and event replay.',
      category: 'shipping',
      version: '1.0.0',
      permissions: JSON.stringify(['read_payments', 'write_orders']),
      pricing: 'freemium',
      price: 0.10,
      config: JSON.stringify({
        marketplace: true,
        capabilities: ['Reserve Stock', 'Release Stock', 'Transfer Stock', 'Create Purchase Order', 'Adjust Inventory'],
        featured: false,
        longDescription: 'Stress-tests persistent state, database migrations, and transaction consistency. Subscribes to sale.completed events to auto-reserve stock.',
        tags: ['inventory', 'warehouse', 'stock', 'supply-chain'],
        pricing: { plan: 'USAGE_BASED', price: 0.10, metric: 'per_transaction' },
      }),
      status: 'published',
      publishedAt: new Date(),
    },
    {
      slug: 'loyalty-rewards',
      name: 'Loyalty & Rewards',
      description: 'Customer loyalty engine with points, tiers, and coupons. Subscribes to payment, sale, delivery, and signup events. Awards points automatically, upgrades tiers, and issues coupons. Validates event routing, ordering, and idempotency.',
      category: 'marketing',
      version: '1.0.0',
      permissions: JSON.stringify(['read_payments', 'read_customers']),
      pricing: 'paid',
      price: 29.00,
      config: JSON.stringify({
        marketplace: true,
        capabilities: ['Award Points', 'Redeem Points', 'Upgrade Tier', 'Issue Coupon'],
        featured: true,
        longDescription: 'Stress-tests event subscriptions and idempotency. Awards 1 point per $1 spent, 5 points per $1 on sales, 10 bonus points on delivery, 50 welcome points on signup. Tiers: BRONZE, SILVER, GOLD, PLATINUM.',
        tags: ['loyalty', 'rewards', 'points', 'tiers', 'coupons'],
        pricing: { plan: 'SUBSCRIPTION', price: 29, interval: 'monthly' },
      }),
      status: 'published',
      publishedAt: new Date(),
    },
    {
      slug: 'accounting',
      name: 'Accounting',
      description: 'Double-entry ledger with journal entries, reconciliation, P&L reports, and exports. All amounts use exact Money (BigInt). Subscribes to payment, delivery, and loyalty events to auto-record entries. Validates financial correctness and precision.',
      category: 'accounting',
      version: '1.0.0',
      permissions: JSON.stringify(['read_payments', 'read_orders']),
      pricing: 'paid',
      price: 49.00,
      config: JSON.stringify({
        marketplace: true,
        capabilities: ['Record Journal Entry', 'Reconcile', 'Generate P&L', 'Export Ledger'],
        featured: true,
        longDescription: 'Stress-tests Money primitives, double-entry correctness, and audit trail. Every entry validates debits = credits using exact BigInt comparison. Seeds 7 accounts (Cash, Inventory, Payable, Revenue, COGS, Marketing, Equity).',
        tags: ['accounting', 'ledger', 'journal', 'reconciliation', 'pnl', 'double-entry'],
        pricing: { plan: 'SUBSCRIPTION', price: 49, interval: 'monthly' },
      }),
      status: 'published',
      publishedAt: new Date(),
    },
    {
      slug: 'crm',
      name: 'CRM',
      description: 'Customer relationship management with pipeline stages, follow-ups, interactions, and workflow automation. Subscribes to sale, delivery, and loyalty events to auto-update pipeline stages and create follow-ups. Validates UI extensibility, routing, and permissions.',
      category: 'crm',
      version: '1.0.0',
      permissions: JSON.stringify(['read_customers', 'write_customers']),
      pricing: 'paid',
      price: 19.00,
      config: JSON.stringify({
        marketplace: true,
        capabilities: ['Create Customer', 'Update Pipeline', 'Create Follow-up', 'Log Interaction'],
        featured: false,
        longDescription: 'Stress-tests UI extensibility and permission system. 6-stage pipeline: LEAD → QUALIFIED → PROPOSAL → NEGOTIATION → CLOSED_WON / LOST. Auto-creates satisfaction follow-ups after delivery, account reviews after tier upgrades.',
        tags: ['crm', 'pipeline', 'follow-ups', 'customer', 'sales'],
        pricing: { plan: 'SUBSCRIPTION', price: 19, interval: 'monthly' },
      }),
      status: 'published',
      publishedAt: new Date(),
    },
  ];

  for (const ext of extensions) {
    const existing = await db.extension.findUnique({ where: { slug: ext.slug } });
    if (existing) {
      await db.extension.update({ where: { slug: ext.slug }, data: { ...ext, developerId: dev.id } });
      console.log(`Updated: ${ext.slug}`);
    } else {
      await db.extension.create({ data: { ...ext, developerId: dev.id } });
      console.log(`Created: ${ext.slug}`);
    }
  }

  console.log(`\n✓ Seeded ${extensions.length} extensions into the marketplace`);
  
  // Verify
  const published = await db.extension.findMany({ where: { status: 'published' } });
  console.log(`Published extensions in marketplace: ${published.length}`);
  for (const p of published) {
    console.log(`  - ${p.slug}: ${p.name} (${p.category}, ${p.pricing})`);
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
