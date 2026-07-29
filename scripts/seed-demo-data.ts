/**
 * Production Demo Data Seed — Optimized version
 * Uses createMany for bulk operations (no nested relation creation)
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
  console.log('  Production Demo Data Seed (Optimized)');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // ── Step 1: Clear ─────────────────────────────────────────────────────
  console.log('━━━ Step 1: Clearing data ━━━');
  // Delete sequentially (not in a transaction — too many tables for one tx)
  await db.walletTransaction.deleteMany(); console.log('  walletTransaction');
  await db.refund.deleteMany(); console.log('  refund');
  await db.payment.deleteMany(); console.log('  payment');
  await db.payout.deleteMany(); console.log('  payout');
  await db.invoice.deleteMany(); console.log('  invoice');
  await db.paymentLink.deleteMany(); console.log('  paymentLink');
  await db.product.deleteMany(); console.log('  product');
  await db.subscription.deleteMany(); console.log('  subscription');
  await db.wallet.deleteMany(); console.log('  wallet');
  await db.eventRecord.deleteMany(); console.log('  eventRecord');
  await db.auditLog.deleteMany(); console.log('  auditLog');
  await db.ledgerEntryRecord.deleteMany(); console.log('  ledgerEntryRecord');
  await db.twinTokenRecord.deleteMany(); console.log('  twinTokenRecord');
  await db.simulationRun.deleteMany(); console.log('  simulationRun');
  await db.ledgerSnapshotRecord.deleteMany(); console.log('  ledgerSnapshotRecord');
  await db.checkpointRecord.deleteMany(); console.log('  checkpointRecord');
  await db.planAmendmentRecord.deleteMany(); console.log('  planAmendmentRecord');
  await db.sAR.deleteMany(); console.log('  sAR');
  await db.aMLAlert.deleteMany(); console.log('  aMLAlert');
  await db.complianceReview.deleteMany(); console.log('  complianceReview');
  await db.lPProfile.deleteMany({ where: { id: { startsWith: 'lp_' } } }); console.log('  lpProfile');
  await db.customer.deleteMany({ where: { id: { startsWith: 'cus_' } } }); console.log('  customer');
  await db.merchant.deleteMany({ where: { OR: [{ id: { startsWith: 'mer_' } }, { name: 'PaySwap Reserve' }] } }); console.log('  merchant');
  await db.account.deleteMany({ where: { OR: [{ id: { startsWith: 'acc_' } }, { id: 'acc_reserve' }] } }); console.log('  account');
  await db.userRole.deleteMany({ where: { OR: [{ userId: { startsWith: 'usr_' } }, { userId: 'usr_reserve' }] } }); console.log('  userRole');
  await db.user.deleteMany({ where: { OR: [{ id: { startsWith: 'usr_' } }, { id: 'usr_reserve' }] } }); console.log('  user');
  console.log('  Cleared all');

  // ── Step 2: 100 Merchants (bulk) ─────────────────────────────────────
  console.log('\n━━━ Step 2: 100 merchants ━━━');
  const merchUsers: any[] = [], merchAccounts: any[] = [], merchRecords: any[] = [], merchRoles: any[] = [];
  for (let i = 0; i < 100; i++) {
    const c = COUNTRIES[i % 4];
    const name = `${MERCHANT_NAMES[i % 20]} ${Math.floor(i / 20) + 1}`;
    const email = `merchant${i + 1}@demo.payswap`;
    const uid = `usr_merchant_${i + 1}`, aid = `acc_merchant_${i + 1}`, mid = `mer_${i + 1}`;
    merchUsers.push({ id: uid, email, passwordHash: PASSWORD_HASH, name, status: 'ACTIVE' });
    merchRoles.push({ id: `role_m_${i}`, userId: uid, role: 'MERCHANT' });
    merchAccounts.push({ id: aid, userId: uid, type: 'MERCHANT', status: 'ACTIVE' });
    merchRecords.push({ id: mid, accountId: aid, name, email, currency: c.currency, country: c.code, status: 'ACTIVE' });
  }
  await db.user.createMany({ data: merchUsers });
  await db.userRole.createMany({ data: merchRoles });
  await db.account.createMany({ data: merchAccounts });
  await db.merchant.createMany({ data: merchRecords });
  console.log('  Done');

  // ── Step 3: 10,000 Customers (bulk) ──────────────────────────────────
  console.log('\n━━━ Step 3: 10,000 customers ━━━');
  const BATCH = 1000;
  for (let batch = 0; batch < 10; batch++) {
    const custUsers: any[] = [], custRoles: any[] = [], custAccounts: any[] = [], custRecords: any[] = [];
    for (let j = 0; j < BATCH; j++) {
      const idx = batch * BATCH + j;
      const c = COUNTRIES[Math.floor(idx / 100) % 4];
      const name = `Customer ${idx + 1}`;
      const email = `customer${idx + 1}@demo.payswap`;
      const uid = `usr_customer_${idx + 1}`, aid = `acc_customer_${idx + 1}`;
      custUsers.push({ id: uid, email, passwordHash: PASSWORD_HASH, name, status: 'ACTIVE' });
      custRoles.push({ id: `role_c_${idx}`, userId: uid, role: 'CUSTOMER' });
      custAccounts.push({ id: aid, userId: uid, type: 'CUSTOMER', status: 'ACTIVE' });
      custRecords.push({ id: `cus_${idx + 1}`, accountId: aid, name, email, phone: `+233${Math.floor(1e9 + Math.random() * 8e9)}`, country: c.name });
    }
    await db.user.createMany({ data: custUsers });
    await db.userRole.createMany({ data: custRoles });
    await db.account.createMany({ data: custAccounts });
    await db.customer.createMany({ data: custRecords });
    console.log(`  Batch ${batch + 1}/10 done (${(batch + 1) * BATCH} customers)`);
  }

  // ── Step 4: 1,000 LPs (bulk) ─────────────────────────────────────────
  console.log('\n━━━ Step 4: 1,000 LPs ━━━');
  for (let ci = 0; ci < 4; ci++) {
    const country = COUNTRIES[ci];
    const lpUsers: any[] = [], lpRoles: any[] = [], lpAccounts: any[] = [], lpRecords: any[] = [];
    for (let i = 0; i < 250; i++) {
      const idx = ci * 250 + i;
      const name = `${LP_NAMES[i % 16]} ${country.code} ${Math.floor(i / 16) + 1}`;
      const email = `lp${idx + 1}@demo.payswap`;
      const uid = `usr_lp_${idx + 1}`, aid = `acc_lp_${idx + 1}`;
      const tier = i < 25 ? 'premium' : i < 100 ? 'verified' : 'basic';
      const stake = i < 25 ? 200000 + Math.random() * 300000 : i < 100 ? 50000 + Math.random() * 100000 : 5000 + Math.random() * 20000;
      const cap = stake * (1.5 + Math.random());
      const fee = 30 + Math.floor(Math.random() * 120);
      lpUsers.push({ id: uid, email, passwordHash: PASSWORD_HASH, name, status: 'ACTIVE' });
      lpRoles.push({ id: `role_l_${idx}`, userId: uid, role: 'LP' });
      lpAccounts.push({ id: aid, userId: uid, type: 'LP', status: 'ACTIVE' });
      lpRecords.push({
        id: `lp_${idx + 1}`, accountId: aid, name, country: country.code,
        currencies: JSON.stringify([country.currency, 'USDC']), tier,
        stake: Math.round(stake * 100) / 100, collateral: Math.round(stake * 0.5 * 100) / 100,
        capacity: JSON.stringify({ [country.currency]: Math.round(cap * 100) / 100, USDC: Math.round(cap * 0.5 * 100) / 100 }),
        feeBps: JSON.stringify({ [`${country.currency}->USDC`]: fee, [`USDC->${country.currency}`]: fee }),
        settlementSpeedMs: 1000 + Math.floor(Math.random() * 10000),
        reputation: Math.round((60 + Math.random() * 40) * 10) / 10, status: 'ACTIVE',
      });
    }
    await db.user.createMany({ data: lpUsers });
    await db.userRole.createMany({ data: lpRoles });
    await db.account.createMany({ data: lpAccounts });
    await db.lPProfile.createMany({ data: lpRecords });
    console.log(`  ${country.name}: 250 LPs done`);
  }

  // ── Step 5: Wallets ───────────────────────────────────────────────────
  console.log('\n━━━ Step 5: Wallets ━━━');
  // Merchant wallets
  const mWallets: any[] = [];
  for (let i = 0; i < 100; i++) {
    const c = COUNTRIES[i % 4];
    const aid = `acc_merchant_${i + 1}`;
    mWallets.push({ accountId: aid, name: 'Settlement Wallet', currency: c.currency, balance: Math.round((10000 + Math.random() * 90000) * 100) / 100, isDefault: true });
    mWallets.push({ accountId: aid, name: 'USDC Wallet', currency: 'USDC', balance: Math.round((1000 + Math.random() * 9000) * 100) / 100, isDefault: false });
  }
  await db.wallet.createMany({ data: mWallets });
  // Customer wallets (batch)
  for (let b = 0; b < 10; b++) {
    const cWallets: any[] = [];
    for (let j = 0; j < 1000; j++) {
      const idx = b * 1000 + j;
      const c = COUNTRIES[Math.floor(idx / 100) % 4];
      cWallets.push({ accountId: `acc_customer_${idx + 1}`, name: 'Wallet', currency: c.currency, balance: Math.round((100 + Math.random() * 4900) * 100) / 100, isDefault: true });
    }
    await db.wallet.createMany({ data: cWallets });
  }
  console.log('  All wallets created');

  // ── Step 6: Reserves ──────────────────────────────────────────────────
  console.log('\n━━━ Step 6: Reserves ━━━');
  await db.user.create({ data: { id: 'usr_reserve', email: 'reserve@payswap.internal', passwordHash: PASSWORD_HASH, name: 'PaySwap Reserve', status: 'ACTIVE', roles: { create: [{ role: 'TREASURY' }] } } });
  await db.account.create({ data: { id: 'acc_reserve', userId: 'usr_reserve', type: 'MERCHANT', status: 'ACTIVE' } });
  await db.merchant.create({ data: { id: 'mer_reserve', accountId: 'acc_reserve', name: 'PaySwap Reserve', email: 'reserve@payswap.internal', currency: 'USD', country: 'GH', status: 'ACTIVE' } });
  await db.wallet.createMany({ data: [
    { accountId: 'acc_reserve', name: 'Ghana Fiat Reserve', currency: 'GHS', balance: 5000000, isDefault: true },
    { accountId: 'acc_reserve', name: 'Togo Fiat Reserve', currency: 'XOF', balance: 3000000, isDefault: false },
    { accountId: 'acc_reserve', name: 'Treasury USDC Reserve', currency: 'USDC', balance: 3500000, isDefault: false },
  ]});
  console.log('  Reserves created (Ghana: GHS 5M, Togo: XOF 3M, Treasury: USDC 3.5M)');

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  const [m, c, l, w, u] = await Promise.all([db.merchant.count(), db.customer.count(), db.lPProfile.count(), db.wallet.count(), db.user.count()]);
  console.log(`  Merchants: ${m} | Customers: ${c} | LPs: ${l} | Wallets: ${w} | Users: ${u}`);
  console.log(`  Password: Payswap123456`);
  console.log(`  Merchants: merchant1-100@demo.payswap`);
  console.log(`  Customers: customer1-10000@demo.payswap`);
  console.log(`  LPs: lp1-1000@demo.payswap`);
  console.log(`  Reserve: reserve@payswap.internal`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');
  await db.$disconnect();
}

main().catch(e => { console.error('SEED FAILED:', e); process.exit(1); });
