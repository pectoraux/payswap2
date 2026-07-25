import { NextRequest, NextResponse } from 'next/server';
import { transactionEngine } from '@/protocol/payments/transaction-engine';
import { liquidityMarketplace } from '@/protocol/liquidity/marketplace';
import { lpLifecycle } from '@/protocol/lp-lifecycle-manager';
import { merchantRegistry } from '@/protocol/merchant-registry';
import { connectorRegistry, OpenBankingConnector, MpesaConnector, EthereumConnector, ExchangeRateConnector } from '@/protocol/connectors/adapters';
import { createEntity } from '@/kernel/entity';
import type { Entity, Evidence } from '@/kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let connectorsInitialized = false;
function initConnectors() {
  if (connectorsInitialized) return;
  connectorRegistry.register(new OpenBankingConnector());
  connectorRegistry.register(new MpesaConnector());
  connectorRegistry.register(new EthereumConnector());
  connectorRegistry.register(new ExchangeRateConnector());
  connectorsInitialized = true;
}

/** POST /api/payment-links — create a payment link (hosted checkout) */
export async function POST(req: NextRequest) {
  initConnectors();
  const body = await req.json();
  const { merchantId, amount, currency, reference, priority = 'cheapest' } = body;

  if (!merchantId || !amount || !currency) {
    return NextResponse.json({ error: 'merchantId, amount, currency required' }, { status: 400 });
  }

  // Setup LP
  liquidityMarketplace.reset();
  lpLifecycle.reset();
  const lpId = 'lp_1';
  liquidityMarketplace.registerLP({
    id: lpId, name: 'Acacia LP', jurisdiction: 'Kenya', currencies: [currency],
    settlementSpeedMs: 50000, capacity: 200000, reputation: 0.85, historicalSuccess: 0.95,
    manualOnly: false, online: true, feeBps: 80,
  });
  lpLifecycle.invite(lpId, 'Acacia LP', 'Kenya', currency);
  lpLifecycle.apply(lpId);
  lpLifecycle.activate(lpId, 200000, 200000);

  if (!merchantRegistry.get(merchantId)) {
    merchantRegistry.register(merchantId, 'Merchant', 'Ghana', currency, 5000);
  }

  // Collect evidence
  const entities: Entity[] = [];
  const evidence: Evidence[] = [];

  const bankResult = await connectorRegistry.query('open_banking', {
    accountId: lpId, currency, expectedBalance: 200000,
  });
  if (bankResult.evidence) { bankResult.evidence.entityId = lpId; evidence.push(bankResult.evidence); }

  entities.push(createEntity('lp', 'Acacia LP', {
    id: `lp:${lpId}`, state: 'active', country: 'Kenya', balance: 200000,
    currency, capabilities: { canBridge: true, canTransfer: true }, policies: { feeBps: 80 },
  }));

  // Create payment
  const intent = transactionEngine.createIntent({
    sourceAmount: amount, sourceCurrency: currency, destinationCurrency: currency,
    senderId: `link_${reference ?? 'pay'}`, receiverId: merchantId, priority,
  });

  // Execute
  const result = transactionEngine.execute(intent.id, entities, evidence);

  let finalResult = result;
  if (result.state === 'escrow_frozen') {
    const settleResult = transactionEngine.confirmSettlement(intent.id, '0x' + intent.id.slice(-8));
    if (settleResult.state === 'merchant_confirming') {
      finalResult = transactionEngine.confirmReceipt(intent.id);
    }
  }

  return NextResponse.json({
    paymentLink: `https://pay.payswap.com/pay/${intent.id}`,
    paymentId: intent.id,
    state: finalResult.state,
    settled: finalResult.settled,
    merchant: merchantId,
    amount,
    currency,
    reference,
  });
}
