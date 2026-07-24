import { NextRequest, NextResponse } from 'next/server';
import { transactionEngine } from '@/protocol/payments/transaction-engine';
import { liquidityMarketplace } from '@/protocol/liquidity/marketplace';
import { lpLifecycle } from '@/protocol/lp-lifecycle-manager';
import { merchantRegistry } from '@/protocol/merchant-registry';
import { createEvidence } from '@/kernel/evidence';
import { createEntity } from '@/kernel/entity';
import type { Entity, Evidence } from '@/kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/payments — create and execute a payment end-to-end */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sourceAmount, sourceCurrency, destinationCurrency, senderId, receiverId, priority } = body;

  if (!sourceAmount || !sourceCurrency || !destinationCurrency || !senderId || !receiverId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // 1. Setup test world (in production: real entities + evidence from connectors)
  // Reset protocol state for clean execution
  liquidityMarketplace.reset();
  lpLifecycle.reset();

  const entities: Entity[] = [];
  const evidence: Evidence[] = [];

  // Register LP
  const lpId = 'lp_1';
  liquidityMarketplace.registerLP({
    id: lpId, name: 'Acacia LP', jurisdiction: 'Kenya',
    currencies: [destinationCurrency], settlementSpeedMs: 50000,
    capacity: 100000, reputation: 0.85, historicalSuccess: 0.95,
    manualOnly: false, online: true, feeBps: 80,
  });
  lpLifecycle.invite(lpId, 'Acacia LP', 'Kenya', destinationCurrency);
  lpLifecycle.apply(lpId);
  lpLifecycle.activate(lpId, 200000, 200000);

  // Register merchant if not already
  if (!merchantRegistry.get(receiverId)) {
    merchantRegistry.register(receiverId, 'Test Merchant', 'Ghana', destinationCurrency, 5000);
  }

  // Create evidence for LP
  evidence.push(createEvidence({
    type: 'attestation', source: 'open_banking', verificationLevel: 'institutional',
    entityId: lpId, attestedAmount: 100000, currency: destinationCurrency,
    reputation: 0.85, attester: 'bank_connector', ttlMs: 60000,
    payload: { kind: 'liquidity_availability_proof', attestedValue: '100000 available' },
  }));

  // Create entities for planner
  entities.push(createEntity('lp', 'Acacia LP', {
    id: `lp:${lpId}`, state: 'active', country: 'Kenya', balance: 100000,
    currency: destinationCurrency, capabilities: { canBridge: true, canTransfer: true },
    policies: { feeBps: 80 },
  }));

  // 2. Create payment intent
  const intent = transactionEngine.createIntent({
    sourceAmount,
    sourceCurrency,
    destinationCurrency,
    senderId,
    receiverId,
    priority: priority ?? 'cheapest',
  });

  // 3. Execute (up to escrow freeze)
  const result = transactionEngine.execute(intent.id, entities, evidence);

  // 4. If escrow frozen, auto-settle (simulate LP fulfillment)
  let finalResult = result;
  if (result.state === 'escrow_frozen') {
    const settleResult = transactionEngine.confirmSettlement(intent.id, 'proof_' + Date.now());
    if (settleResult.state === 'merchant_confirming') {
      finalResult = transactionEngine.confirmReceipt(intent.id);
    }
  }

  return NextResponse.json({
    payment: transactionEngine.getStatus(intent.id),
    result: finalResult,
  });
}

/** GET /api/payments — list all payments */
export async function GET() {
  return NextResponse.json({ payments: transactionEngine.listPayments() });
}
