import { db } from '../src/lib/db';

async function main() {
  // Find the developer user
  const dev = await db.user.findUnique({ where: { email: 'developer@payswap.demo' } });
  if (!dev) throw new Error('developer not found');

  // Create a new extension in submitted state
  const existing = await db.extension.findUnique({ where: { slug: 'currency-hedging-ai' } });
  let ext;
  if (existing) {
    ext = await db.extension.update({
      where: { id: existing.id },
      data: {
        name: 'Currency Hedging AI',
        description: 'AI-driven FX hedging recommendations for multi-currency merchants. Automatically suggests forward contracts and natural hedges based on your exposure.',
        developerId: dev.id,
        category: 'ai',
        version: '0.9.0',
        status: 'submitted',
        permissions: JSON.stringify(['read_payments','read_wallets','read_treasury','send_webhooks']),
        pricing: 'paid',
        price: 149,
        installCount: 0,
        rating: 0,
        reviewCount: 0,
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        reviewNotes: null,
        publishedAt: null,
      },
    });
  } else {
    ext = await db.extension.create({
      data: {
        slug: 'currency-hedging-ai',
        name: 'Currency Hedging AI',
        description: 'AI-driven FX hedging recommendations for multi-currency merchants. Automatically suggests forward contracts and natural hedges based on your exposure.',
        developerId: dev.id,
        category: 'ai',
        version: '0.9.0',
        status: 'submitted',
        permissions: JSON.stringify(['read_payments','read_wallets','read_treasury','send_webhooks']),
        pricing: 'paid',
        price: 149,
        config: JSON.stringify({ type:'object', properties:{ apiKey:{type:'string',title:'AI API Key'}, horizon:{type:'string',title:'Hedging horizon',enum:['7d','30d','90d'],default:'30d'} }, required:['apiKey'] }),
      },
    });
  }
  console.log('Submitted extension id:', ext.id, 'status:', ext.status);
}
main().then(()=>db.$disconnect()).catch(e=>{console.error(e);db.$disconnect();process.exit(1);});
