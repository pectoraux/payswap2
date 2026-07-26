/**
 * PaySwap Expanded Seed — creates multiple merchants, LPs, customers,
 * and payment history so the World Simulator has actors to work with.
 */
import { db } from '../src/lib/db';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('🌱 Expanding seed data...\n');
  const ph = await bcrypt.hash('Payswap123456', 12);

  // ─── ADMIN ──────────────────────────────────────────────────────────────
  await db.user.upsert({
    where: { email: 'ekontetevi@gmail.com' },
    update: {},
    create: { email: 'ekontetevi@gmail.com', passwordHash: ph, name: 'Tetevi Placide Ekon', phone: '+233244000000', status: 'ACTIVE', emailVerified: new Date(), roles: { create: [{ role: 'SUPER_ADMIN' }] } },
  });
  console.log('✅ Admin');

  // ─── MERCHANTS ──────────────────────────────────────────────────────────
  const merchants = [
    { name: 'Accra Coffee Co.', email: 'merchant@payswap.demo', country: 'Ghana', currency: 'GHS', desc: 'Single-origin Ghanaian cocoa and coffee, roasted in Accra.', biz: 'SMALL_BUSINESS' },
    { name: 'Kumasi Electronics', email: 'kumasi@payswap.demo', country: 'Ghana', currency: 'GHS', desc: 'Electronics and gadgets in the heart of Kumasi.', biz: 'ENTERPRISE' },
    { name: 'Cape Coast Pharmacy', email: 'pharmacy@payswap.demo', country: 'Ghana', currency: 'GHS', desc: 'Licensed pharmacy serving Cape Coast.', biz: 'SMALL_BUSINESS' },
    { name: 'Tamale Groceries', email: 'tamale@payswap.demo', country: 'Ghana', currency: 'GHS', desc: 'Fresh groceries and household goods in Tamale.', biz: 'SMALL_BUSINESS' },
  ];

  for (const m of merchants) {
    const user = await db.user.upsert({
      where: { email: m.email },
      update: {},
      create: { email: m.email, passwordHash: ph, name: m.name + ' Owner', phone: '+233244' + Math.floor(100000 + Math.random() * 899999), status: 'ACTIVE', emailVerified: new Date() },
    });

    const existingMerchant = await db.merchant.findUnique({ where: { email: m.email } });
    if (existingMerchant) { console.log(`  ⏭️  ${m.name} already exists`); continue; }

    const account = await db.account.create({
      data: {
        userId: user.id, type: 'MERCHANT', status: 'ACTIVE',
        merchant: { create: { name: m.name, legalName: m.name + ' Ltd', email: m.email, phone: '+233244' + Math.floor(100000 + Math.random() * 899999), country: m.country, currency: m.currency, description: m.desc, businessType: m.biz, tier: 'TRUSTED', bond: 5000, status: 'ACTIVE', kycLevel: 2 } },
      },
      include: { merchant: true },
    });

    await db.userRole.create({ data: { userId: user.id, role: 'MERCHANT', merchantId: account.merchant!.id } });
    await db.wallet.create({ data: { accountId: account.id, name: m.currency + ' Wallet', currency: m.currency, balance: 10000 + Math.random() * 50000, isDefault: true } });
    await db.teamMember.create({ data: { merchantId: account.merchant!.id, email: m.email, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date(), userId: user.id } });

    // Products
    const products = m.name.includes('Coffee') ? [
      { name: 'Single Origin Cocoa (500g)', price: 75 }, { name: 'Dark Roast Coffee (1kg)', price: 120 }, { name: 'Cocoa Butter (250g)', price: 45 },
    ] : m.name.includes('Electronics') ? [
      { name: 'USB-C Cable', price: 25 }, { name: 'Phone Case', price: 35 }, { name: 'Wireless Earbuds', price: 180 }, { name: 'Power Bank 10000mAh', price: 95 },
    ] : m.name.includes('Pharmacy') ? [
      { name: 'Paracetamol (50 tabs)', price: 15 }, { name: 'Vitamin C (100 tabs)', price: 30 }, { name: 'First Aid Kit', price: 65 },
    ] : [
      { name: 'Rice 5kg', price: 55 }, { name: 'Cooking Oil 2L', price: 40 }, { name: 'Tomatoes 1kg', price: 12 }, { name: 'Bread Loaf', price: 8 },
    ];

    for (const p of products) {
      await db.product.create({ data: { merchantId: account.merchant!.id, name: p.name, description: p.name, price: p.price, currency: m.currency, type: 'PHYSICAL', status: 'ACTIVE', environment: 'live' } });
    }

    // API Key + Webhook
    await db.apiKey.create({ data: { merchantId: account.merchant!.id, label: 'Production', keyPrefix: 'psk_live_xxxx', keyHash: await bcrypt.hash('psk_live_demo', 10), scopes: JSON.stringify(['payments:read','payments:write','payouts:read','payouts:write','webhooks:read']), status: 'ACTIVE' } });
    await db.webhookEndpoint.create({ data: { merchantId: account.merchant!.id, url: `https://${m.name.toLowerCase().replace(/\s+/g, '')}.gh/webhooks/payswap`, secretHash: await bcrypt.hash('wh_sec_demo', 10), events: JSON.stringify(['payment.created','payment.completed','payment.failed','payout.completed']), status: 'ACTIVE' } });

    console.log(`✅ ${m.name}`);
  }

  // ─── LPs ────────────────────────────────────────────────────────────────
  const lpData = [
    { name: 'Ghana Liquidity Ltd', email: 'lp@payswap.demo', country: 'Ghana', stake: 200000 },
    { name: 'West Africa FX', email: 'lp2@payswap.demo', country: 'Nigeria', stake: 350000 },
    { name: 'Accra Settlement Partners', email: 'lp3@payswap.demo', country: 'Ghana', stake: 150000 },
  ];

  for (const lp of lpData) {
    const user = await db.user.upsert({ where: { email: lp.email }, update: {}, create: { email: lp.email, passwordHash: ph, name: lp.name, phone: '+233244' + Math.floor(100000 + Math.random() * 899999), status: 'ACTIVE', emailVerified: new Date(), roles: { create: [{ role: 'LP' }] } } });
    const existing = await db.lPProfile.findFirst({ where: { name: lp.name } });
    if (existing) { console.log(`  ⏭️  ${lp.name} already exists`); continue; }
    await db.account.create({ data: { userId: user.id, type: 'LP', status: 'ACTIVE', lpProfile: { create: { name: lp.name, country: lp.country, currencies: JSON.stringify(['GHS','KES']), tier: 'trusted', stake: lp.stake, collateral: lp.stake * 0.8, capacity: JSON.stringify({ 'GHS→KES': lp.stake }), reputation: 0.80 + Math.random() * 0.15, status: 'active' } } } });
    console.log(`✅ ${lp.name}`);
  }

  // ─── CUSTOMER ───────────────────────────────────────────────────────────
  const cu = await db.user.upsert({ where: { email: 'customer@payswap.demo' }, update: {}, create: { email: 'customer@payswap.demo', passwordHash: ph, name: 'Ama Serwaa', phone: '+233244222222', status: 'ACTIVE', emailVerified: new Date(), roles: { create: [{ role: 'CUSTOMER' }] } } });
  const existingCustomer = await db.customer.findFirst({ where: { email: 'customer@payswap.demo' } });
  if (!existingCustomer) {
    const ca = await db.account.create({ data: { userId: cu.id, type: 'CUSTOMER', status: 'ACTIVE', customer: { create: { name: 'Ama Serwaa', email: 'customer@payswap.demo', phone: '+233244222222', country: 'Ghana', totalSpent: 450, transactionCount: 6 } } } });
    await db.wallet.create({ data: { accountId: ca.id, name: 'GHS Wallet', currency: 'GHS', balance: 500, isDefault: true } });
  }
  console.log('✅ Customer');

  // ─── OTHER ROLES ────────────────────────────────────────────────────────
  for (const [email, name, role] of [['treasury@payswap.demo','Treasury Operator','TREASURY'],['compliance@payswap.demo','Compliance Officer','COMPLIANCE'],['support@payswap.demo','Support Agent','SUPPORT'],['ops@payswap.demo','Operations Engineer','OPERATIONS'],['developer@payswap.demo','Developer','DEVELOPER']] as const) {
    await db.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: ph, name, status: 'ACTIVE', emailVerified: new Date(), roles: { create: [{ role }] } } });
  }
  console.log('✅ Other roles');

  // ─── WAITLIST ───────────────────────────────────────────────────────────
  for (const e of [{email:'waitlist1@example.com',name:'John Doe',company:'Doe Trading',country:'Nigeria',businessType:'SMALL_BUSINESS'},{email:'waitlist2@example.com',name:'Jane Smith',company:'Smith Retail',country:'Kenya',businessType:'ENTERPRISE'}]) {
    await db.waitlistEntry.upsert({ where: { email: e.email }, update: {}, create: { ...e, status: 'PENDING' } });
  }
  console.log('✅ Waitlist');

  // ─── GENERATE PAYMENT HISTORY ──────────────────────────────────────────
  const allMerchants = await db.merchant.findMany({ where: { status: 'ACTIVE' } });
  const allLps = await db.lPProfile.findMany({ where: { status: 'active' } });
  if (allMerchants.length === 0 || allLps.length === 0) { console.log('\n⚠️  No merchants/LPs found for payment history'); return; }

  const customerNames = ['Kwame Mensah','Ama Serwaa','Kofi Boateng','Akosua Asante','Yaw Owusu','Efua Darko','Kwesi Annan','Adwoa Frimpong','Kojo Antwi','Abena Osei','John Appiah','Grace Adjei','Michael Owusu','Sarah Boateng','David Asante','Linda Frimpong'];

  console.log('\n📊 Generating payment history...');
  let paymentCount = 0;
  for (const merchant of allMerchants) {
    // Create customer records for this merchant
    for (const name of customerNames.slice(0, 8)) {
      const email = `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`;
      const existing = await db.customerRecord.findFirst({ where: { merchantId: merchant.id, email } });
      if (existing) continue;
      await db.customerRecord.create({ data: { merchantId: merchant.id, name, email, phone: '+233244' + Math.floor(1000000 + Math.random() * 8999999), country: merchant.country, totalSpent: 0, transactionCount: 0, environment: 'live' } });
    }

    // Generate 15-25 payments per merchant
    const customers = await db.customerRecord.findMany({ where: { merchantId: merchant.id } });
    if (customers.length === 0) continue;
    const numPayments = 15 + Math.floor(Math.random() * 10);

    for (let i = 0; i < numPayments; i++) {
      const customer = customers[Math.floor(Math.random() * customers.length)];
      const lp = allLps[Math.floor(Math.random() * allLps.length)];
      const amount = Math.round((20 + Math.random() * 300) * 100) / 100;
      const fee = Math.round(amount * 0.008 * 100) / 100;
      const net = Math.round((amount - fee) * 100) / 100;
      const method = ['MOBILE_MONEY','BANK','QR','CHECKOUT'][Math.floor(Math.random() * 4)];
      const success = Math.random() < 0.95;
      const daysAgo = Math.floor(Math.random() * 30);
      const ts = new Date(Date.now() - daysAgo * 86400000 - Math.random() * 86400000);

      const payment = await db.payment.create({
        data: {
          merchantId: merchant.id, customerId: null,
          amount, currency: merchant.currency,
          sourceCurrency: merchant.currency, destinationCurrency: merchant.currency,
          status: success ? 'COMPLETED' : 'FAILED', method,
          corridor: `${merchant.currency}-${merchant.currency}`,
          lpId: lp.id, fee, netAmount: success ? net : 0, fxRate: 1,
          reference: `PAY-${String(paymentCount + 1).padStart(4, '0')}`,
          description: `${method} - ${customer.name}`,
          settledAt: success ? ts : null,
          environment: 'live', createdAt: ts, updatedAt: ts,
        },
      });
      paymentCount++;

      if (success) {
        await db.customerRecord.update({ where: { id: customer.id }, data: { totalSpent: { increment: amount }, transactionCount: { increment: 1 } } });
      }

      // Webhook delivery
      const webhooks = await db.webhookEndpoint.findMany({ where: { merchantId: merchant.id, status: 'ACTIVE' } });
      for (const wh of webhooks) {
        const ok = Math.random() > 0.05;
        await db.webhookDelivery.create({ data: { endpointId: wh.id, eventType: success ? 'payment.completed' : 'payment.failed', payload: JSON.stringify({ id: payment.id, amount, currency: merchant.currency, status: payment.status }), signature: `sha256=${uuidv4().slice(0, 64)}`, status: ok ? 'DELIVERED' : 'FAILED', attempts: ok ? 1 : 2, responseStatus: ok ? 200 : 500, responseBody: ok ? 'OK' : 'Error', deliveredAt: ok ? ts : null, createdAt: ts } });
      }

      // Refund (3%)
      if (success && Math.random() < 0.03) {
        await db.refund.create({ data: { merchantId: merchant.id, paymentId: payment.id, amount: Math.random() < 0.3 ? amount : Math.round(amount * 0.5 * 100) / 100, type: 'FULL', reason: 'Customer request', status: 'PROCESSED', requestedBy: 'system', processedAt: new Date(ts.getTime() + 3600000), createdAt: new Date(ts.getTime() + 3600000) } });
      }

      // Audit log
      await db.auditLog.create({ data: { action: 'SEED.PAYMENT', resourceType: 'Payment', resourceId: payment.id, result: 'SUCCESS', details: JSON.stringify({ amount, merchant: merchant.name, customer: customer.name }), createdAt: ts } });
    }

    // Generate 1-3 payouts per merchant
    for (let i = 0; i < 1 + Math.floor(Math.random() * 3); i++) {
      const amount = Math.round((100 + Math.random() * 2000) * 100) / 100;
      const fee = Math.round(amount * 0.005 * 100) / 100;
      const net = Math.round((amount - fee) * 100) / 100;
      const ts = new Date(Date.now() - Math.floor(Math.random() * 30) * 86400000);
      await db.payout.create({ data: { merchantId: merchant.id, method: ['BANK','MOBILE_MONEY'][Math.floor(Math.random()*2)], sourceAmount: amount, sourceAsset: `TWIN${merchant.currency}`, sourceCurrency: merchant.currency, destinationCurrency: merchant.currency, destination: JSON.stringify({bankAccount:'GH'+Math.floor(Math.random()*1e12)}), fxRate: 1, feeBps: 50, fee, netAmount: net, status: 'COMPLETED', txHash: 'seed_tx_'+uuidv4().slice(0,8), evidence: JSON.stringify({source:'open_banking'}), createdAt: ts, processedAt: ts, completedAt: ts, environment: 'live' } });
    }
  }
  console.log(`✅ ${paymentCount} payments across ${allMerchants.length} merchants`);

  console.log('\n🎉 Seed complete!');
  console.log('━━━ Login ━━━');
  console.log('Admin: ekontetevi@gmail.com / Payswap123456');
  console.log('Merchant: merchant@payswap.demo / Payswap123456');
}

main().then(()=>db.$disconnect()).catch(e=>{console.error(e);db.$disconnect();process.exit(1);});
