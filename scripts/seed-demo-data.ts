/**
 * Production Demo Data Seed
 *
 * Clears all demo transactional data and creates:
 *   - 100 merchants (across Ghana, Nigeria, Kenya, Togo)
 *   - 10,000 customers (100 per merchant)
 *   - 1,000 LPs (250 per country: Kenya, Togo, Ghana, Nigeria)
 *   - Reserves: Togo + Ghana have fiat reserves; all 4 countries have LPs
 *   - Twin tokens, stablecoins, and fiat bandwidth per LP
 *   - Realistic wallet balances for each account
 *
 * All accounts share password: Payswap123456
 * Demo accounts do NOT show as quick logins (they're for runtime testing)
 *
 * Usage: export DATABASE_URL="..." NEXTAUTH_SECRET="..."; bun run scripts/seed-demo-data.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const PASSWORD_HASH = await bcrypt.hash('Payswap123456', 10);

// Use base PrismaClient (no $extends) for seeding — avoids extension typing issues
const db = new PrismaClient({ log: ['error'] });
const COUNTRIES = [
  { code: 'GH', name: 'Ghana', currency: 'GHS', hasReserve: true },
  { code: 'TG', name: 'Togo', currency: 'XOF', hasReserve: true },
  { code: 'KE', name: 'Kenya', currency: 'KES', hasReserve: false },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', hasReserve: false },
];

const MERCHANT_NAMES = [
  'Accra Coffee Co', 'Lome Market', 'Nairobi Tech Hub', 'Lagos Foods',
  'Kumasi Textiles', 'Kara Trading', 'Mombasa Imports', 'Abuja Electronics',
  'Takoradi Logistics', 'Sokode Farms', 'Eldoret Pharma', 'Port Harcourt Oil',
  'Tamale Agro', 'Atakpame Foods', 'Kisumu Fishing', 'Kano Textiles',
  'Cape Coast Tourism', 'Notse Crafts', 'Nakuru Dairy', 'Ibadan Plastics',
];

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  Production Demo Data Seed');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // ── Step 1: Clear all transactional data (order matters for FK constraints) ──
  console.log('━━━ Step 1: Clearing existing transactional data ━━━');
  // Delete in dependency order (children first, parents last)
  await db.walletTransaction.deleteMany();
  await db.refund.deleteMany();
  await db.payment.deleteMany();
  await db.payout.deleteMany();
  await db.invoice.deleteMany();
  await db.paymentLink.deleteMany();
  await db.product.deleteMany();
  await db.subscription.deleteMany();
  await db.wallet.deleteMany();
  await db.eventRecord.deleteMany();
  await db.auditLog.deleteMany();
  await db.ledgerEntryRecord.deleteMany();
  await db.twinTokenRecord.deleteMany();
  await db.simulationRun.deleteMany();
  await db.ledgerSnapshotRecord.deleteMany();
  await db.checkpointRecord.deleteMany();
  await db.planAmendmentRecord.deleteMany();
  await db.sAR.deleteMany();
  await db.aMLAlert.deleteMany();
  await db.complianceReview.deleteMany();
  // Delete old demo accounts (keep the original 9 demo users)
  await db.lPProfile.deleteMany({ where: { id: { startsWith: 'lp_' } } });
  await db.customer.deleteMany({ where: { id: { startsWith: 'cus_' } } });
  await db.merchant.deleteMany({ where: { id: { startsWith: 'mer_' } } });
  await db.account.deleteMany({ where: { id: { startsWith: 'acc_merchant_' } } });
  await db.account.deleteMany({ where: { id: { startsWith: 'acc_customer_' } } });
  await db.account.deleteMany({ where: { id: { startsWith: 'acc_lp_' } } });
  await db.userRole.deleteMany({ where: { userId: { startsWith: 'usr_merchant_' } } });
  await db.userRole.deleteMany({ where: { userId: { startsWith: 'usr_customer_' } } });
  await db.userRole.deleteMany({ where: { userId: { startsWith: 'usr_lp_' } } });
  await db.user.deleteMany({ where: { id: { startsWith: 'usr_merchant_' } } });
  await db.user.deleteMany({ where: { id: { startsWith: 'usr_customer_' } } });
  await db.user.deleteMany({ where: { id: { startsWith: 'usr_lp_' } } });
  console.log('  Cleared transactional + demo records');

  // ── Step 2: Create 100 merchants ──────────────────────────────────────
  console.log('\n━━━ Step 2: Creating 100 merchants ━━━');
  const merchantAccounts = [];
  const merchantUsers = [];
  const merchantRecords = [];

  for (let i = 0; i < 100; i++) {
    const country = COUNTRIES[i % COUNTRIES.length];
    const name = `${MERCHANT_NAMES[i % MERCHANT_NAMES.length]} ${Math.floor(i / MERCHANT_NAMES.length) + 1}`;
    const email = `merchant${i + 1}@demo.payswap`;
    const userId = `usr_merchant_${i + 1}`;

    // User (with role)
    await db.user.create({
      data: {
        id: userId,
        email,
        passwordHash: PASSWORD_HASH,
        name,
        status: 'ACTIVE',
        roles: { create: [{ role: 'MERCHANT' }] },
      },
    });

    // Account
    const account = await db.account.create({
      data: { id: `acc_merchant_${i + 1}`, userId, type: "MERCHANT", status: "ACTIVE" },
    });

    // Merchant
    await db.merchant.create({
      data: {
        id: `mer_${i + 1}`,
        accountId: account.id,
        name,
        email,
        currency: country.currency,
        country: country.code,
        status: 'ACTIVE',
      },
    });
  }
  console.log(`  Created 100 merchants`);

  // ── Step 3: Create 10,000 customers (100 per merchant) ────────────────
  console.log('\n━━━ Step 3: Creating 10,000 customers ━━━');
  let customerCount = 0;

  for (let m = 0; m < 100; m++) {
    const country = COUNTRIES[m % COUNTRIES.length];
    for (let c = 0; c < 100; c++) {
      const idx = m * 100 + c;
      const name = `Customer ${idx + 1}`;
      const email = `customer${idx + 1}@demo.payswap`;
      const userId = `usr_customer_${idx + 1}`;

      await db.user.create({
        data: {
          id: userId,
          email,
          passwordHash: PASSWORD_HASH,
          name,
          status: 'ACTIVE',
          roles: { create: [{ role: 'CUSTOMER' }] },
        },
      });

      const account = await db.account.create({
        data: { id: `acc_customer_${idx + 1}`, userId, type: "CUSTOMER", status: "ACTIVE" },
      });

      await db.customer.create({
        data: {
          id: `cus_${idx + 1}`,
          accountId: account.id,
          name,
          email,
          phone: `+233${Math.floor(1000000000 + Math.random() * 8999999999)}`,
          country: country.name,
          currency: country.currency,
          status: 'ACTIVE',
        },
      });
      customerCount++;
    }
    if ((m + 1) % 10 === 0) console.log(`  ... ${customerCount} customers created`);
  }
  console.log(`  Created ${customerCount} customers`);

  // ── Step 4: Create 1,000 LPs (250 per country) ────────────────────────
  console.log('\n━━━ Step 4: Creating 1,000 LPs ━━━');
  let lpCount = 0;

  const LP_NAMES = [
    'Sahara Capital', 'Acacia Liquidity', 'Victoria Partners', 'Baobab Fund',
    'Savannah LP', 'Delta Liquidity', 'Highland Capital', 'Coastal Partners',
    'Rift Valley LP', 'Mango Tree Capital', 'Cedar Liquidity', 'Ebony Fund',
    'Nile Liquidity', 'Atlas Partners', 'Zambezi Capital', 'Lagoon Trading',
  ];

  for (let countryIdx = 0; countryIdx < COUNTRIES.length; countryIdx++) {
    const country = COUNTRIES[countryIdx];
    for (let i = 0; i < 250; i++) {
      const idx = countryIdx * 250 + i;
      const name = `${LP_NAMES[i % LP_NAMES.length]} ${country.code} ${Math.floor(i / LP_NAMES.length) + 1}`;
      const email = `lp${idx + 1}@demo.payswap`;
      const userId = `usr_lp_${idx + 1}`;

      const tier = i < 25 ? 1 : i < 100 ? 2 : 3;
      const stake = tier === 1 ? 200_000 + Math.random() * 300_000
        : tier === 2 ? 50_000 + Math.random() * 100_000
        : 5_000 + Math.random() * 20_000;

      const fiatBW = stake * (1.5 + Math.random());
      const capacity = Math.round(fiatBW * 100) / 100;

      await db.user.create({
        data: {
          id: userId,
          email,
          passwordHash: PASSWORD_HASH,
          name,
          status: 'ACTIVE',
          roles: { create: [{ role: 'LP' }] },
        },
      });

      const account = await db.account.create({
        data: { id: `acc_lp_${idx + 1}`, userId, type: "LP", status: "ACTIVE" },
      });

      await db.lPProfile.create({
        data: {
          id: `lp_${idx + 1}`,
          accountId: account.id,
          name,
          country: country.code,
          currencies: JSON.stringify([country.currency, 'USDC']),
          tier,
          stake: Math.round(stake * 100) / 100,
          collateral: Math.round(stake * 0.5 * 100) / 100,
          capacity,
          feeBps: 30 + Math.floor(Math.random() * 120),
          settlementSpeedMs: 1000 + Math.floor(Math.random() * 10000),
          reputation: Math.round((60 + Math.random() * 40) * 10) / 10,
          bond: Math.round(stake * 0.1 * 100) / 100,
          status: 'ACTIVE',
        },
      });
      lpCount++;
    }
    console.log(`  ... ${lpCount} LPs created`);
  }
  console.log(`  Created ${lpCount} LPs (250 per country)`);

  // ── Step 5: Create wallets with realistic balances ────────────────────
  console.log('\n━━━ Step 5: Creating wallets with realistic balances ━━━');

  // Merchant wallets (settlement wallets — higher balances)
  const merchantWallets = [];
  for (let i = 0; i < 100; i++) {
    const country = COUNTRIES[i % COUNTRIES.length];
    const merchant = merchantRecords[i];
    merchantWallets.push({
      accountId: merchant.accountId,
      name: `${merchant.name} Settlement Wallet`,
      currency: country.currency,
      balance: Math.round((10_000 + Math.random() * 90_000) * 100) / 100,
      isDefault: true,
    });
    // USDC wallet for cross-border
    merchantWallets.push({
      accountId: merchant.accountId,
      name: `${merchant.name} USDC Wallet`,
      currency: 'USDC',
      balance: Math.round((1_000 + Math.random() * 9_000) * 100) / 100,
      isDefault: false,
    });
  }
  await db.wallet.createMany({ data: merchantWallets });

  // Customer wallets (personal wallets — smaller balances)
  const customerWallets = [];
  for (let i = 0; i < 10000; i++) {
    const country = COUNTRIES[Math.floor(i / 100) % COUNTRIES.length];
    const customer = customerRecords[i];
    customerWallets.push({
      accountId: customer.accountId,
      name: `${customer.name} Wallet`,
      currency: country.currency,
      balance: Math.round((100 + Math.random() * 4_900) * 100) / 100,
      isDefault: true,
    });
  }
  // Batch insert
  for (let i = 0; i < customerWallets.length; i += 1000) {
    await db.wallet.createMany({ data: customerWallets.slice(i, i + 1000) });
  }
  console.log(`  Created ${merchantWallets.length + customerWallets.length} wallets`);

  // ── Step 6: Create treasury reserve wallets (Togo + Ghana) ────────────
  console.log('\n━━━ Step 6: Creating treasury reserve wallets ━━━');
  const reserveWallets = [];

  // Find or create reserve merchant
  let reserveMerchant = await db.merchant.findFirst({ where: { name: 'PaySwap Reserve' } });
  if (!reserveMerchant) {
    const reserveAccount = await db.account.create({
      data: { id: 'acc_reserve', email: 'reserve@payswap.internal', name: 'PaySwap Reserve', type: 'MERCHANT', status: 'ACTIVE' },
    });
    reserveMerchant = await db.merchant.create({
      data: { id: 'mer_reserve', accountId: reserveAccount.id, name: 'PaySwap Reserve', email: 'reserve@payswap.internal', currency: 'USD', country: 'GH', status: 'ACTIVE' },
    });
  }

  // Ghana reserve (fiat)
  reserveWallets.push({
    accountId: reserveMerchant.accountId,
    name: 'Ghana Fiat Reserve',
    currency: 'GHS',
    balance: 5_000_000,
    isDefault: true,
  });
  // Ghana USDC
  reserveWallets.push({
    accountId: reserveMerchant.accountId,
    name: 'Ghana Stablecoin Reserve',
    currency: 'USDC',
    balance: 1_000_000,
    isDefault: false,
  });
  // Togo reserve (fiat)
  reserveWallets.push({
    accountId: reserveMerchant.accountId,
    name: 'Togo Fiat Reserve',
    currency: 'XOF',
    balance: 3_000_000,
    isDefault: false,
  });
  // Togo USDC
  reserveWallets.push({
    accountId: reserveMerchant.accountId,
    name: 'Togo Stablecoin Reserve',
    currency: 'USDC',
    balance: 500_000,
    isDefault: false,
  });
  // Global USDC treasury
  reserveWallets.push({
    accountId: reserveMerchant.accountId,
    name: 'Treasury Stablecoin Reserve',
    currency: 'USDC',
    balance: 2_000_000,
    isDefault: false,
  });

  await db.wallet.createMany({ data: reserveWallets });
  console.log(`  Created ${reserveWallets.length} reserve wallets (Ghana + Togo)`);

  // ── Step 7: Print summary ─────────────────────────────────────────────
  console.log('\n━━━ Summary ━━━');
  const counts = await Promise.all([
    db.merchant.count(), db.customer.count(), db.lPProfile.count(),
    db.wallet.count(), db.user.count(),
  ]);
  console.log(`  Merchants: ${counts[0]}`);
  console.log(`  Customers: ${counts[1]}`);
  console.log(`  LPs: ${counts[2]}`);
  console.log(`  Wallets: ${counts[3]}`);
  console.log(`  Users: ${counts[4]}`);
  console.log(`\n  All passwords: Payswap123456`);
  console.log(`  Demo accounts: merchant1@demo.payswap through merchant100@demo.payswap`);
  console.log(`  Demo accounts: customer1@demo.payswap through customer10000@demo.payswap`);
  console.log(`  Demo accounts: lp1@demo.payswap through lp1000@demo.payswap`);
  console.log(`\n  Reserves: Ghana (GHS 5M + USDC 1M), Togo (XOF 3M + USDC 500K)`);
  console.log(`  No reserves: Kenya, Nigeria (LP bandwidth only)`);
  console.log('\n═══════════════════════════════════════════════════════════════════════\n');

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
