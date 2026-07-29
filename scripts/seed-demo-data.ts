/**
 * Production Demo Data Seed
 *
 * Clears all demo transactional data and creates:
 *   - 100 merchants (across Ghana, Nigeria, Kenya, Togo)
 *   - 10,000 customers (100 per merchant)
 *   - 1,000 LPs (250 per country: Kenya, Togo, Ghana, Nigeria)
 *   - Reserves: Togo + Ghana have fiat reserves; all 4 countries have LPs
 *   - Realistic wallet balances for each account
 *
 * All accounts share password: Payswap123456
 * Demo accounts do NOT show as quick logins (they're for runtime testing)
 *
 * Usage: export DATABASE_URL="..." NEXTAUTH_SECRET="..."; bun run scripts/seed-demo-data.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const PASSWORD_HASH = bcrypt.hashSync('Payswap123456', 10);
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

const LP_NAMES = [
  'Sahara Capital', 'Acacia Liquidity', 'Victoria Partners', 'Baobab Fund',
  'Savannah LP', 'Delta Liquidity', 'Highland Capital', 'Coastal Partners',
  'Rift Valley LP', 'Mango Tree Capital', 'Cedar Liquidity', 'Ebony Fund',
  'Nile Liquidity', 'Atlas Partners', 'Zambezi Capital', 'Lagoon Trading',
];

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  Production Demo Data Seed');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // ── Step 1: Clear all transactional data ──────────────────────────────
  console.log('━━━ Step 1: Clearing existing data ━━━');
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
  // Delete demo accounts (keep original 9 demo users)
  await db.lPProfile.deleteMany({ where: { id: { startsWith: 'lp_' } } });
  await db.customer.deleteMany({ where: { id: { startsWith: 'cus_' } } });
  await db.merchant.deleteMany({ where: { id: { startsWith: 'mer_' } } });
  await db.merchant.deleteMany({ where: { name: 'PaySwap Reserve' } });
  await db.account.deleteMany({ where: { id: { startsWith: 'acc_merchant_' } } });
  await db.account.deleteMany({ where: { id: { startsWith: 'acc_customer_' } } });
  await db.account.deleteMany({ where: { id: { startsWith: 'acc_lp_' } } });
  await db.account.deleteMany({ where: { id: 'acc_reserve' } });
  await db.userRole.deleteMany({ where: { userId: { startsWith: 'usr_merchant_' } } });
  await db.userRole.deleteMany({ where: { userId: { startsWith: 'usr_customer_' } } });
  await db.userRole.deleteMany({ where: { userId: { startsWith: 'usr_lp_' } } });
  await db.user.deleteMany({ where: { id: { startsWith: 'usr_merchant_' } } });
  await db.user.deleteMany({ where: { id: { startsWith: 'usr_customer_' } } });
  await db.user.deleteMany({ where: { id: { startsWith: 'usr_lp_' } } });
  console.log('  Cleared all data');

  // ── Step 2: Create 100 merchants ──────────────────────────────────────
  console.log('\n━━━ Step 2: Creating 100 merchants ━━━');
  const merchantIds: string[] = [];

  for (let i = 0; i < 100; i++) {
    const country = COUNTRIES[i % COUNTRIES.length];
    const name = `${MERCHANT_NAMES[i % MERCHANT_NAMES.length]} ${Math.floor(i / MERCHANT_NAMES.length) + 1}`;
    const email = `merchant${i + 1}@demo.payswap`;
    const userId = `usr_merchant_${i + 1}`;
    const accountId = `acc_merchant_${i + 1}`;
    const merchantId = `mer_${i + 1}`;

    await db.user.create({
      data: { id: userId, email, passwordHash: PASSWORD_HASH, name, status: 'ACTIVE', roles: { create: [{ role: 'MERCHANT' }] } },
    });
    await db.account.create({ data: { id: accountId, userId, type: 'MERCHANT', status: 'ACTIVE' } });
    await db.merchant.create({
      data: { id: merchantId, accountId, name, email, currency: country.currency, country: country.code, status: 'ACTIVE' },
    });
    merchantIds.push(merchantId);
  }
  console.log('  Created 100 merchants');

  // ── Step 3: Create 10,000 customers ───────────────────────────────────
  console.log('\n━━━ Step 3: Creating 10,000 customers ━━━');
  let customerCount = 0;
  const customerAccountIds: string[] = [];

  for (let m = 0; m < 100; m++) {
    const country = COUNTRIES[m % COUNTRIES.length];
    for (let c = 0; c < 100; c++) {
      const idx = m * 100 + c;
      const name = `Customer ${idx + 1}`;
      const email = `customer${idx + 1}@demo.payswap`;
      const userId = `usr_customer_${idx + 1}`;
      const accountId = `acc_customer_${idx + 1}`;

      await db.user.create({
        data: { id: userId, email, passwordHash: PASSWORD_HASH, name, status: 'ACTIVE', roles: { create: [{ role: 'CUSTOMER' }] } },
      });
      await db.account.create({ data: { id: accountId, userId, type: 'CUSTOMER', status: 'ACTIVE' } });
      await db.customer.create({
        data: { id: `cus_${idx + 1}`, accountId, name, email, phone: `+233${Math.floor(1000000000 + Math.random() * 8999999999)}`, country: country.name },
      });
      customerAccountIds.push(accountId);
      customerCount++;
    }
    if ((m + 1) % 10 === 0) console.log(`  ... ${customerCount} customers created`);
  }
  console.log(`  Created ${customerCount} customers`);

  // ── Step 4: Create 1,000 LPs ──────────────────────────────────────────
  console.log('\n━━━ Step 4: Creating 1,000 LPs ━━━');
  let lpCount = 0;

  for (let countryIdx = 0; countryIdx < COUNTRIES.length; countryIdx++) {
    const country = COUNTRIES[countryIdx];
    for (let i = 0; i < 250; i++) {
      const idx = countryIdx * 250 + i;
      const name = `${LP_NAMES[i % LP_NAMES.length]} ${country.code} ${Math.floor(i / LP_NAMES.length) + 1}`;
      const email = `lp${idx + 1}@demo.payswap`;
      const userId = `usr_lp_${idx + 1}`;
      const accountId = `acc_lp_${idx + 1}`;

      // Tier: 10% premium, 30% verified, 60% basic
      const tier = i < 25 ? 'premium' : i < 100 ? 'verified' : 'basic';
      const stakeAmount = i < 25 ? 200_000 + Math.random() * 300_000
        : i < 100 ? 50_000 + Math.random() * 100_000
        : 5_000 + Math.random() * 20_000;
      const capacityAmount = stakeAmount * (1.5 + Math.random());
      const feeBpsVal = 30 + Math.floor(Math.random() * 120);

      await db.user.create({
        data: { id: userId, email, passwordHash: PASSWORD_HASH, name, status: 'ACTIVE', roles: { create: [{ role: 'LP' }] } },
      });
      await db.account.create({ data: { id: accountId, userId, type: 'LP', status: 'ACTIVE' } });
      await db.lPProfile.create({
        data: {
          id: `lp_${idx + 1}`,
          accountId,
          name,
          country: country.code,
          currencies: JSON.stringify([country.currency, 'USDC']),
          tier,
          stake: Math.round(stakeAmount * 100) / 100,
          collateral: Math.round(stakeAmount * 0.5 * 100) / 100,
          capacity: JSON.stringify({ [country.currency]: Math.round(capacityAmount * 100) / 100, USDC: Math.round(capacityAmount * 0.5 * 100) / 100 }),
          feeBps: JSON.stringify({ [`${country.currency}->USDC`]: feeBpsVal, [`USDC->${country.currency}`]: feeBpsVal }),
          settlementSpeedMs: 1000 + Math.floor(Math.random() * 10000),
          reputation: Math.round((60 + Math.random() * 40) * 10) / 10,
          status: 'ACTIVE',
        },
      });
      lpCount++;
    }
    console.log(`  ... ${lpCount} LPs created (${country.name})`);
  }
  console.log(`  Created ${lpCount} LPs`);

  // ── Step 5: Create wallets ────────────────────────────────────────────
  console.log('\n━━━ Step 5: Creating wallets ━━━');

  // Merchant wallets
  const merchantWalletData: any[] = [];
  for (let i = 0; i < 100; i++) {
    const country = COUNTRIES[i % COUNTRIES.length];
    const accountId = `acc_merchant_${i + 1}`;
    merchantWalletData.push({ accountId, name: `Settlement Wallet`, currency: country.currency, balance: Math.round((10_000 + Math.random() * 90_000) * 100) / 100, isDefault: true });
    merchantWalletData.push({ accountId, name: `USDC Wallet`, currency: 'USDC', balance: Math.round((1_000 + Math.random() * 9_000) * 100) / 100, isDefault: false });
  }
  await db.wallet.createMany({ data: merchantWalletData });

  // Customer wallets (batch in chunks of 1000)
  for (let i = 0; i < 10000; i += 1000) {
    const chunk: any[] = [];
    for (let j = i; j < Math.min(i + 1000, 10000); j++) {
      const country = COUNTRIES[Math.floor(j / 100) % COUNTRIES.length];
      chunk.push({ accountId: `acc_customer_${j + 1}`, name: `Wallet`, currency: country.currency, balance: Math.round((100 + Math.random() * 4_900) * 100) / 100, isDefault: true });
    }
    await db.wallet.createMany({ data: chunk });
  }
  console.log(`  Created ${merchantWalletData.length + 10000} wallets`);

  // ── Step 6: Treasury reserve wallets ──────────────────────────────────
  console.log('\n━━━ Step 6: Creating treasury reserves ━━━');
  // Create reserve user + account + merchant
  await db.user.create({ data: { id: 'usr_reserve', email: 'reserve@payswap.internal', passwordHash: PASSWORD_HASH, name: 'PaySwap Reserve', status: 'ACTIVE', roles: { create: [{ role: 'TREASURY' }] } } });
  await db.account.create({ data: { id: 'acc_reserve', userId: 'usr_reserve', type: 'MERCHANT', status: 'ACTIVE' } });
  await db.merchant.create({ data: { id: 'mer_reserve', accountId: 'acc_reserve', name: 'PaySwap Reserve', email: 'reserve@payswap.internal', currency: 'USD', country: 'GH', status: 'ACTIVE' } });

  const reserveWallets = [
    { accountId: 'acc_reserve', name: 'Ghana Fiat Reserve', currency: 'GHS', balance: 5_000_000, isDefault: true },
    { accountId: 'acc_reserve', name: 'Ghana Stablecoin Reserve', currency: 'USDC', balance: 1_000_000, isDefault: false },
    { accountId: 'acc_reserve', name: 'Togo Fiat Reserve', currency: 'XOF', balance: 3_000_000, isDefault: false },
    { accountId: 'acc_reserve', name: 'Togo Stablecoin Reserve', currency: 'USDC', balance: 500_000, isDefault: false },
    { accountId: 'acc_reserve', name: 'Treasury USDC', currency: 'USDC', balance: 2_000_000, isDefault: false },
  ];
  await db.wallet.createMany({ data: reserveWallets });
  console.log('  Created reserve wallets (Ghana: GHS 5M + USDC 1M, Togo: XOF 3M + USDC 500K)');

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  const [merchants, customers, lps, wallets, users] = await Promise.all([
    db.merchant.count(), db.customer.count(), db.lPProfile.count(), db.wallet.count(), db.user.count(),
  ]);
  console.log(`  Merchants: ${merchants}`);
  console.log(`  Customers: ${customers}`);
  console.log(`  LPs: ${lps}`);
  console.log(`  Wallets: ${wallets}`);
  console.log(`  Users: ${users}`);
  console.log(`\n  All passwords: Payswap123456`);
  console.log(`  Merchants: merchant1@demo.payswap ... merchant100@demo.payswap`);
  console.log(`  Customers: customer1@demo.payswap ... customer10000@demo.payswap`);
  console.log(`  LPs: lp1@demo.payswap ... lp1000@demo.payswap`);
  console.log(`  Reserve: reserve@payswap.internal`);
  console.log(`\n  Reserves: Ghana (GHS 5M + USDC 1M), Togo (XOF 3M + USDC 500K)`);
  console.log(`  No reserves: Kenya, Nigeria (LP bandwidth only)`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
