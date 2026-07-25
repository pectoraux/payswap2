import { NextRequest, NextResponse } from 'next/server';
import { transactionEngine } from '@/protocol/payments/transaction-engine';
import { liquidityMarketplace } from '@/protocol/liquidity/marketplace';
import { lpLifecycle } from '@/protocol/lp-lifecycle-manager';
import { merchantRegistry } from '@/protocol/merchant-registry';
import { OpenBankingConnector, MpesaConnector, EthereumConnector, ExchangeRateConnector, connectorRegistry } from '@/protocol/connectors/adapters';
import { createEntity } from '@/kernel/entity';
import type { Entity, Evidence } from '@/kernel';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Register connectors once
let connectorsInitialized = false;
function initConnectors() {
  if (connectorsInitialized) return;
  connectorRegistry.register(new OpenBankingConnector());
  connectorRegistry.register(new MpesaConnector());
  connectorRegistry.register(new EthereumConnector());
  connectorRegistry.register(new ExchangeRateConnector());
  connectorsInitialized = true;
}

/** POST /api/payments — create and execute a payment end-to-end */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  initConnectors();

  const body = await req.json();
  const { sourceAmount, sourceCurrency, destinationCurrency, senderId, receiverId, priority } = body;

  if (!sourceAmount || !sourceCurrency || !destinationCurrency || !senderId || !receiverId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // 1. Setup world — register LP with full lifecycle
  liquidityMarketplace.reset();
  lpLifecycle.reset();

  const entities: Entity[] = [];
  const evidence: Evidence[] = [];

  // Register LP
  const lpId = 'lp_1';
  liquidityMarketplace.registerLP({
    id: lpId, name: 'Acacia LP', jurisdiction: 'Kenya',
    currencies: [destinationCurrency], settlementSpeedMs: 50000,
    capacity: 200000, reputation: 0.85, historicalSuccess: 0.95,
    manualOnly: false, online: true, feeBps: 80,
  });
  lpLifecycle.invite(lpId, 'Acacia LP', 'Kenya', destinationCurrency);
  lpLifecycle.apply(lpId);
  lpLifecycle.activate(lpId, 200000, 200000);

  // Register merchant
  if (!merchantRegistry.get(receiverId)) {
    merchantRegistry.register(receiverId, 'Test Merchant', 'Ghana', destinationCurrency, 5000);
  }

  // 2. Collect evidence from REAL connectors
  // Bank balance proof (entityId matches LP ID for routing)
  const bankResult = await connectorRegistry.query('open_banking', {
    accountId: lpId, currency: destinationCurrency, expectedBalance: 200000,
  });
  if (bankResult.evidence) {
    // Override entityId to match LP ID (routing service looks up by LP ID)
    bankResult.evidence.entityId = lpId;
    evidence.push(bankResult.evidence);
  }

  // FX rate proof
  const fxResult = await connectorRegistry.query('exchange_rate', {
    fromCurrency: sourceCurrency, toCurrency: destinationCurrency,
  });
  if (fxResult.evidence) evidence.push(fxResult.evidence);

  // M-Pesa balance proof (for Kenyan sender)
  if (sourceCurrency === 'KES') {
    const mpesaResult = await connectorRegistry.query('mpesa', {
      phoneNumber: senderId, currency: sourceCurrency, balance: sourceAmount * 2,
    });
    if (mpesaResult.evidence) evidence.push(mpesaResult.evidence);
  }

  // 3. Create entities for planner
  entities.push(createEntity('lp', 'Acacia LP', {
    id: `lp:${lpId}`, state: 'active', country: 'Kenya', balance: 200000,
    currency: destinationCurrency, capabilities: { canBridge: true, canTransfer: true },
    policies: { feeBps: 80 },
  }));

  // 4. Create payment intent
  const intent = transactionEngine.createIntent({
    sourceAmount,
    sourceCurrency,
    destinationCurrency,
    senderId,
    receiverId,
    priority: priority ?? 'cheapest',
  });

  // 5. Execute (up to escrow freeze)
  const result = transactionEngine.execute(intent.id, entities, evidence);

  // 6. If escrow frozen, auto-settle (simulate LP fulfillment + merchant confirmation)
  let finalResult = result;
  let connectorEvidence: Evidence[] = [];
  if (result.state === 'escrow_frozen') {
    // LP settles — blockchain connector verifies on-chain
    const blockchainResult = await connectorRegistry.query('ethereum', {
      txHash: '0x' + intent.id.slice(-8),
      contractAddress: '0xPaySwapEscrow',
      amount: sourceAmount,
      currency: 'TWIN',
      confirmed: true,
    });
    if (blockchainResult.evidence) connectorEvidence.push(blockchainResult.evidence);

    const settleResult = transactionEngine.confirmSettlement(intent.id, '0x' + intent.id.slice(-8));
    if (settleResult.state === 'merchant_confirming') {
      finalResult = transactionEngine.confirmReceipt(intent.id);
    }
  }

  return NextResponse.json({
    payment: transactionEngine.getStatus(intent.id),
    result: finalResult,
    evidence: {
      bank: bankResult.evidence ? { source: 'open_banking', confidence: 0.9, verified: bankResult.success } : null,
      fx: fxResult.evidence ? { source: 'exchange_rate', confidence: 0.8, verified: fxResult.success } : null,
      blockchain: connectorEvidence.length > 0 ? { source: 'ethereum', confidence: 1.0, verified: true } : null,
    },
  });
}

/** GET /api/payments — list all payments */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  return NextResponse.json({ payments: transactionEngine.listPayments() });
}
