import { db } from '../src/lib/db';

async function main() {
  // Find the customer demo user
  const user = await db.user.findUnique({ where: { email: 'customer@payswap.demo' } });
  if (!user) { console.log('Customer user not found'); return; }

  // Find or create account
  let account = await db.account.findFirst({ where: { userId: user.id, type: 'CUSTOMER' }, include: { customer: true, wallets: true } });
  
  if (!account) {
    // Create customer record first
    const customer = await db.customer.create({
      data: {
        name: user.name || 'Demo Customer',
        email: user.email,
        phone: '+233244567890',
        status: 'ACTIVE',
        totalSpent: 0,
      },
    });
    
    account = await db.account.create({
      data: {
        userId: user.id,
        type: 'CUSTOMER',
        customerId: customer.id,
        status: 'ACTIVE',
      },
      include: { customer: true, wallets: true },
    });
    console.log(`Created customer account: ${account.id}`);
  }

  // Ensure wallets exist
  if (account.wallets.length === 0) {
    const wallet = await db.wallet.create({
      data: {
        accountId: account.id,
        name: 'GHS Wallet',
        currency: 'GHS',
        balance: 500,
        pendingBalance: 0,
        lockedBalance: 0,
        isDefault: true,
      },
    });
    console.log(`Created wallet: ${wallet.id} (GHS 500)`);

    const wallet2 = await db.wallet.create({
      data: {
        accountId: account.id,
        name: 'USD Wallet',
        currency: 'USD',
        balance: 50,
        pendingBalance: 0,
        lockedBalance: 0,
        isDefault: false,
      },
    });
    console.log(`Created wallet: ${wallet2.id} (USD 50)`);
  } else {
    console.log(`Customer already has ${account.wallets.length} wallets`);
  }

  console.log('✓ Customer demo account ready with wallets');
}

main().catch(console.error).finally(() => process.exit(0));
