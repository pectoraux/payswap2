import { db } from '../src/lib/db';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('Seeding...');
  const ph = await bcrypt.hash('Payswap123456', 12);

  // Admin
  const admin = await db.user.upsert({
    where: { email: 'ekontetevi@gmail.com' },
    update: {},
    create: { email: 'ekontetevi@gmail.com', passwordHash: ph, name: 'Tetevi Placide Ekon', phone: '+233244000000', status: 'ACTIVE', emailVerified: new Date(), roles: { create: [{ role: 'SUPER_ADMIN' }] } },
  });
  console.log('Admin:', admin.email);

  // Merchant
  const mu = await db.user.upsert({ where: { email: 'merchant@payswap.demo' }, update: {}, create: { email: 'merchant@payswap.demo', passwordHash: ph, name: 'Kwame Asante', phone: '+233244111111', status: 'ACTIVE', emailVerified: new Date() } });
  const ma = await db.account.create({ data: { userId: mu.id, type: 'MERCHANT', status: 'ACTIVE', merchant: { create: { name: 'Accra Coffee Co.', legalName: 'Accra Coffee Company Ltd', email: 'merchant@payswap.demo', phone: '+233244111111', country: 'Ghana', currency: 'GHS', website: 'https://accracoffee.gh', description: 'Single-origin Ghanaian cocoa and coffee.', businessType: 'SMALL_BUSINESS', tier: 'TRUSTED', bond: 5000, status: 'ACTIVE', kycLevel: 2 } } }, include: { merchant: true } });
  await db.userRole.create({ data: { userId: mu.id, role: 'MERCHANT', merchantId: ma.merchant!.id } });
  await db.wallet.create({ data: { accountId: ma.id, name: 'GHS Wallet', currency: 'GHS', balance: 25000, isDefault: true } });
  await db.product.createMany({ data: [
    { merchantId: ma.merchant!.id, name: 'Single Origin Cocoa Bag (500g)', description: 'Premium cocoa.', price: 75, currency: 'GHS', type: 'PHYSICAL', status: 'ACTIVE' },
    { merchantId: ma.merchant!.id, name: 'Dark Roast Coffee (1kg)', description: 'Rich dark roast.', price: 120, currency: 'GHS', type: 'PHYSICAL', status: 'ACTIVE' },
  ]});
  await db.customerRecord.createMany({ data: [
    { merchantId: ma.merchant!.id, name: 'Ama Serwaa', email: 'ama@example.com', phone: '+233244222222', country: 'Ghana', totalSpent: 450, transactionCount: 6 },
    { merchantId: ma.merchant!.id, name: 'Kofi Boateng', email: 'kofi@example.com', phone: '+233244333333', country: 'Ghana', totalSpent: 280, transactionCount: 4 },
  ]});
  for (let i = 0; i < 12; i++) {
    const amt = [50,75,120,150,200,75,50,120,300,75,200,150][i];
    await db.payment.create({ data: { merchantId: ma.merchant!.id, amount: amt, currency: 'GHS', status: 'COMPLETED', method: ['MOBILE_MONEY','BANK','QR','CHECKOUT'][i%4], fee: Math.round(amt*0.005*100)/100, netAmount: Math.round(amt*0.995*100)/100, fxRate: 1, reference: `PAY-${String(i+1).padStart(4,'0')}`, description: `Payment for order #${i+1}`, settledAt: new Date(Date.now()-i*3600000) } });
  }
  await db.payout.create({ data: { merchantId: ma.merchant!.id, method: 'BANK', sourceAmount: 1000, sourceAsset: 'TWINGHS', sourceCurrency: 'GHS', destinationCurrency: 'GHS', destination: JSON.stringify({bankAccount:'GH0001234567890'}), fxRate: 1, feeBps: 50, fee: 5, netAmount: 995, status: 'COMPLETED', txHash: 'bank_tx_'+uuidv4().slice(0,8), evidence: JSON.stringify({source:'open_banking'}), completedAt: new Date() } });
  await db.apiKey.create({ data: { merchantId: ma.merchant!.id, label: 'Production', keyPrefix: 'psk_live_xxxx', keyHash: await bcrypt.hash('psk_live_demo',10), scopes: JSON.stringify(['payments:read','payments:write','payouts:read','payouts:write','webhooks:read']), status: 'ACTIVE' } });
  await db.webhookEndpoint.create({ data: { merchantId: ma.merchant!.id, url: 'https://accracoffee.gh/webhooks/payswap', secretHash: await bcrypt.hash('wh_sec_demo',10), events: JSON.stringify(['payment.created','payment.completed','payment.failed','payout.completed']), status: 'ACTIVE' } });
  await db.teamMember.create({ data: { merchantId: ma.merchant!.id, email: 'merchant@payswap.demo', role: 'OWNER', status: 'ACTIVE', joinedAt: new Date(), userId: mu.id } });
  console.log('Merchant:', mu.email);

  // Customer
  const cu = await db.user.upsert({ where: { email: 'customer@payswap.demo' }, update: {}, create: { email: 'customer@payswap.demo', passwordHash: ph, name: 'Ama Serwaa', phone: '+233244222222', status: 'ACTIVE', emailVerified: new Date(), roles: { create: [{ role: 'CUSTOMER' }] } } });
  const ca = await db.account.create({ data: { userId: cu.id, type: 'CUSTOMER', status: 'ACTIVE', customer: { create: { name: 'Ama Serwaa', email: 'customer@payswap.demo', phone: '+233244222222', country: 'Ghana', totalSpent: 450, transactionCount: 6 } } } });
  await db.wallet.create({ data: { accountId: ca.id, name: 'GHS Wallet', currency: 'GHS', balance: 500, isDefault: true } });
  console.log('Customer:', cu.email);

  // LP
  const lu = await db.user.upsert({ where: { email: 'lp@payswap.demo' }, update: {}, create: { email: 'lp@payswap.demo', passwordHash: ph, name: 'Acacia Liquidity', phone: '+254722000000', status: 'ACTIVE', emailVerified: new Date(), roles: { create: [{ role: 'LP' }] } } });
  await db.account.create({ data: { userId: lu.id, type: 'LP', status: 'ACTIVE', lpProfile: { create: { name: 'Acacia Liquidity Provider', country: 'Kenya', currencies: JSON.stringify(['KES','GHS']), tier: 'trusted', stake: 200000, collateral: 200000, capacity: JSON.stringify({'GHS→KES':200000}), reputation: 0.85, status: 'active' } } } });
  console.log('LP:', lu.email);

  // Other roles
  for (const [email, name, role] of [['treasury@payswap.demo','Treasury Operator','TREASURY'],['compliance@payswap.demo','Compliance Officer','COMPLIANCE'],['support@payswap.demo','Support Agent','SUPPORT'],['ops@payswap.demo','Operations Engineer','OPERATIONS'],['developer@payswap.demo','Developer','DEVELOPER']] as const) {
    await db.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: ph, name, status: 'ACTIVE', emailVerified: new Date(), roles: { create: [{ role }] } } });
    console.log(role+':', email);
  }

  // Waitlist
  for (const e of [{email:'waitlist1@example.com',name:'John Doe',company:'Doe Trading',country:'Nigeria',businessType:'SMALL_BUSINESS',status:'PENDING'},{email:'waitlist2@example.com',name:'Jane Smith',company:'Smith Retail',country:'Kenya',businessType:'ENTERPRISE',status:'PENDING'}]) {
    await db.waitlistEntry.upsert({ where: { email: e.email }, update: {}, create: e });
  }
  console.log('Waitlist: 2 entries');
  console.log('\nDone! Login: ekontetevi@gmail.com / Payswap123456');
}
main().then(()=>db.$disconnect()).catch(e=>{console.error(e);db.$disconnect();process.exit(1);});
