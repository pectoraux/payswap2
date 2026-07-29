import { db } from '../src/lib/db';
async function main() {
  const [merchants, customers, lps, payments, payouts, refunds, wallets, events, users] = await Promise.all([
    db.merchant.count(), db.customer.count(), db.lPProfile.count(),
    db.payment.count(), db.payout.count(), db.refund.count(),
    db.wallet.count(), db.eventRecord.count(), db.user.count(),
  ]);
  console.log('Merchants:', merchants);
  console.log('Customers:', customers);
  console.log('LPs:', lps);
  console.log('Payments:', payments);
  console.log('Payouts:', payouts);
  console.log('Refunds:', refunds);
  console.log('Wallets:', wallets);
  console.log('Events:', events);
  console.log('Users:', users);
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
