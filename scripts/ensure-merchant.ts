import { db } from '../src/lib/db';

async function main() {
  const user = await db.user.findUnique({ where: { email: 'merchant@payswap.demo' } });
  if (!user) { console.log('Merchant user not found'); return; }

  // Check roles
  const roles = await db.userRole.findMany({ where: { userId: user.id } });
  console.log('Roles:', roles.map(r => r.role));

  // Find merchant by email
  let merchant = await db.merchant.findFirst({ where: { email: user.email } });

  if (!merchant) {
    // Find the user's account
    let account = await db.account.findFirst({ where: { userId: user.id, type: 'MERCHANT' } });
    if (!account) {
      account = await db.account.create({
        data: { userId: user.id, type: 'MERCHANT', status: 'ACTIVE' },
      });
    }

    merchant = await db.merchant.create({
      data: {
        accountId: account.id,
        name: 'Demo Merchant',
        legalName: 'Demo Merchant Ltd',
        email: user.email,
        country: 'GH',
        currency: 'GHS',
        status: 'ACTIVE',
        tier: 'VERIFIED',
        bond: 1000,
        kycLevel: 2,
      },
    });
    console.log(`Created merchant: ${merchant.id}`);
    
    // Link to user role
    await db.userRole.updateMany({
      where: { userId: user.id, role: 'MERCHANT' },
      data: { merchantId: merchant.id },
    });
  } else {
    console.log(`Merchant exists: ${merchant.id}`);
    // Make sure roles have merchantId
    await db.userRole.updateMany({
      where: { userId: user.id, role: 'MERCHANT' },
      data: { merchantId: merchant.id },
    });
  }

  // Create a wallet for the merchant
  const wallets = await db.wallet.findMany({ where: { accountId: merchant.accountId } });
  if (wallets.length === 0) {
    await db.wallet.create({
      data: {
        accountId: merchant.accountId,
        name: 'GHS Wallet',
        currency: 'GHS',
        balance: 10000,
        isDefault: true,
      },
    });
    console.log('Created merchant GHS wallet');
  }

  console.log('✓ Merchant demo account ready');
}

main().catch(console.error).finally(() => process.exit(0));
