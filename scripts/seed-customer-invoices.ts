/**
 * PaySwap — Seed demo invoices for the demo customer.
 *
 * Creates 6 demo invoices from various merchants (we re-use Accra Coffee Co.
 * since it is the only seeded merchant; we vary the items/currency/due-date
 * so the list looks realistic). Idempotent: re-running it will delete any
 * existing demo invoices for the demo customer (those with number prefix
 * `DEMO-INV-`) and re-create them.
 *
 * Run: `bun run scripts/seed-customer-invoices.ts`
 */
import { db } from '../src/lib/db';

interface SeedInvoice {
  number: string;
  merchantName: string;
  items: { description: string; quantity: number; unitPrice: number }[];
  tax: number;
  currency: 'GHS' | 'USD';
  status: 'PENDING' | 'PAID' | 'OVERDUE';
  dueOffsetDays: number; // days from now (negative = past, positive = future)
}

const SEED: SeedInvoice[] = [
  {
    number: 'DEMO-INV-0001',
    merchantName: 'Accra Coffee Co.',
    items: [
      { description: 'Single Origin Cocoa Bag (500g)', quantity: 1, unitPrice: 50 },
    ],
    tax: 0,
    currency: 'GHS',
    status: 'PENDING',
    dueOffsetDays: 7,
  },
  {
    number: 'DEMO-INV-0002',
    merchantName: 'Accra Coffee Co.',
    items: [
      { description: 'Dark Roast Coffee (1kg)', quantity: 1, unitPrice: 120 },
    ],
    tax: 0,
    currency: 'GHS',
    status: 'PENDING',
    dueOffsetDays: 14,
  },
  {
    number: 'DEMO-INV-0003',
    merchantName: 'Accra Coffee Co.',
    items: [
      { description: 'Premium Cocoa Subscription (monthly)', quantity: 1, unitPrice: 75 },
    ],
    tax: 0,
    currency: 'USD',
    status: 'PENDING',
    dueOffsetDays: 3,
  },
  {
    number: 'DEMO-INV-0004',
    merchantName: 'Accra Coffee Co.',
    items: [
      { description: 'Wholesale coffee beans (10kg)', quantity: 2, unitPrice: 100 },
    ],
    tax: 0,
    currency: 'GHS',
    status: 'OVERDUE',
    dueOffsetDays: -5,
  },
  {
    number: 'DEMO-INV-0005',
    merchantName: 'Accra Coffee Co.',
    items: [
      { description: 'Specialty drip coffee kit', quantity: 1, unitPrice: 15 },
    ],
    tax: 0,
    currency: 'USD',
    status: 'PENDING',
    dueOffsetDays: 21,
  },
  {
    number: 'DEMO-INV-0006',
    merchantName: 'Accra Coffee Co.',
    items: [
      { description: 'Catering order — office pack', quantity: 1, unitPrice: 300 },
    ],
    tax: 0,
    currency: 'GHS',
    status: 'PAID',
    dueOffsetDays: -30,
  },
];

async function main() {
  console.log('🌱 Seeding customer invoices…\n');

  const customer = await db.customer.findFirst({
    where: { email: 'customer@payswap.demo' },
  });
  if (!customer) {
    throw new Error('Demo customer not found. Run scripts/seed.ts first.');
  }
  console.log(`  Customer: ${customer.name} <${customer.email}> (${customer.id})`);

  const merchant = await db.merchant.findFirst({
    where: { email: 'merchant@payswap.demo' },
  });
  if (!merchant) {
    throw new Error('Demo merchant not found. Run scripts/seed.ts first.');
  }
  console.log(`  Merchant: ${merchant.name} (${merchant.id})`);

  // Wipe prior demo invoices for this customer (idempotent re-run).
  const deleted = await db.invoice.deleteMany({
    where: { customerId: customer.id, number: { startsWith: 'DEMO-INV-' } },
  });
  if (deleted.count > 0) {
    console.log(`  Removed ${deleted.count} prior demo invoices.`);
  }

  let n = 0;
  for (const s of SEED) {
    const subtotal = s.items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
    const tax = (subtotal * s.tax) / 100;
    const total = subtotal + tax;
    const dueDate = new Date(Date.now() + s.dueOffsetDays * 24 * 60 * 60 * 1000);
    const sentAt = s.status === 'PAID' || s.status === 'OVERDUE' || s.status === 'PENDING'
      ? new Date(Date.now() - Math.abs(s.dueOffsetDays) * 24 * 60 * 60 * 1000)
      : null;
    const paidAt = s.status === 'PAID'
      ? new Date(Date.now() - Math.abs(s.dueOffsetDays) * 24 * 60 * 60 * 1000 + 60 * 60 * 1000)
      : null;

    const inv = await db.invoice.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        number: s.number,
        items: JSON.stringify(s.items),
        subtotal,
        tax,
        total,
        currency: s.currency,
        status: s.status,
        dueDate,
        sentAt,
        paidAt,
        environment: 'sandbox',
      },
    });

    console.log(
      `  + ${inv.number}  ${s.currency.padEnd(3)} ${total.toFixed(2).padStart(8)}  ${s.status.padEnd(8)}  due ${dueDate.toISOString().slice(0, 10)}`,
    );
    n++;
  }

  console.log(`\n🎉 Seeded ${n} demo invoices for ${customer.email}.`);
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error('Seed failed:', e);
    db.$disconnect();
    process.exit(1);
  });
